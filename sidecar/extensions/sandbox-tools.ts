/**
 * sandbox-tools — Pi extension for agent bash tool sandboxing.
 *
 * Hooks:
 * - user_bash: wraps command execution with SandboxService.createSandboxedBashOps()
 * - tool_result: detects sandbox violations, surfaces escape hatch message to agent
 * - session_shutdown: calls SandboxManager.reset() for cleanup
 *
 * Escape hatch flow:
 * 1. Violation detected in tool_result → store PendingApproval, append /sandbox-allow prompt to result
 * 2. Agent calls /sandbox-allow <reason> → calls _sendToClient with SANDBOX_APPROVAL_REQUEST
 * 3. User approves in UI → server.ts receives SANDBOX_APPROVAL_RESPONSE, calls grantApproval()
 * 4. grantApproval() sets bypassNextCall = true
 * 5. Next user_bash call sees bypassNextCall, clears it, returns undefined (unsandboxed)
 *
 * server.ts is responsible for:
 * - Calling setSendToClient() with the active ws.send function after a WS connection opens
 * - Calling grantApproval() when SANDBOX_APPROVAL_RESPONSE arrives
 *
 * See: docs/architecture/sandbox-runtime.md
 */

import type { ExtensionAPI, ExtensionCommandContext, ToolResultEvent } from '@mariozechner/pi-coding-agent';

type BashToolResultEvent = Extract<ToolResultEvent, { toolName: 'bash' }>;
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { SandboxService } from '../sandbox/SandboxService.js';
import { WS_EVENTS } from '../../src/types.js';

interface PendingApproval {
  approvalId: string;
  violationContext: string; // first 200 chars of blocked output, for WS payload
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// Keyed by approvalId (UUID). Entries expire after 5 minutes.
const pendingApprovals = new Map<string, PendingApproval>();

// Number of pending approved bypasses across all sessions.
// Using a counter (not a boolean) ensures concurrent sessions don't steal each other's approval —
// each grantApproval() increments the count, each user_bash consume decrements it.
let bypassCount = 0;

// Injected by server.ts after a WS connection is established.
let _sendToClient: ((msg: object) => void) | null = null;

/** Violation patterns for macOS (Seatbelt) and Linux (bubblewrap) */
const VIOLATION_PATTERNS = [
  /Operation not permitted/i,
  /Permission denied/i,   // Linux bubblewrap non-zero exit
  /Sandbox: deny/i,
  /sandbox-exec:/i,
  /bwrap: Can't/i,
];

/**
 * Returns true if a bash tool result represents a sandbox violation.
 * Uses isError (non-zero exit) as a gate, then pattern-matches the output.
 */
function isSandboxViolation(output: string, isError: boolean): boolean {
  if (!isError) return false;
  return VIOLATION_PATTERNS.some(p => p.test(output));
}

/**
 * Provide a WebSocket send function so this extension can relay
 * SANDBOX_APPROVAL_REQUEST messages to the client.
 * Called by server.ts when a WS connection opens.
 */
export function setSendToClient(fn: (msg: object) => void): void {
  _sendToClient = fn;
}

/**
 * Mark the next user_bash call as bypassed (unsandboxed).
 * Called by server.ts when SANDBOX_APPROVAL_RESPONSE is received.
 */
export function grantApproval(approvalId: string): void {
  const approval = pendingApprovals.get(approvalId);
  if (approval) {
    clearTimeout(approval.timer);
    pendingApprovals.delete(approvalId);
  }
  // Increment bypass counter regardless of whether the ID was in pendingApprovals.
  // This handles test scenarios where grantApproval is called without a prior
  // violation. server.ts validates the approvalId and approved=true before calling this.
  bypassCount++;
}

export default function sandboxToolsExtension(pi: ExtensionAPI) {
  /**
   * user_bash — intercept bash execution.
   * Returns BashOperations to replace default execution with sandboxed version.
   * Returns undefined to use default execution (Windows, unsupported, approved bypass).
   */
  pi.on('user_bash', () => {
    // Consume one approved bypass if available. Using a counter (not boolean)
    // ensures each grantApproval() consumes exactly one user_bash call even
    // when multiple sessions run concurrently.
    if (bypassCount > 0) {
      bypassCount--;
      return; // undefined → default (unsandboxed) execution
    }

    if (!SandboxService.isSupported) return;

    const ops = SandboxService.createSandboxedBashOps('agent');
    if (!ops) return;
    return { operations: ops };
  });

  /**
   * tool_result — detect sandbox violations and offer escape hatch.
   * Stores a PendingApproval and returns modified content so the agent
   * knows to call /sandbox-allow.
   *
   * The Pi SDK delivers bash output in event.content (TextContent[]) and
   * uses event.isError=true for non-zero exit codes. We read output from
   * content and return { content: [...original, escapeHatchBlock] }.
   */
  pi.on('tool_result', (event: ToolResultEvent) => {
    if (event.toolName !== 'bash') return;
    const bashEvent = event as BashToolResultEvent;

    // Extract text from all TextContent blocks
    const output = bashEvent.content
      .filter((c): c is { type: 'text'; text: string } => (c as { type: string }).type === 'text')
      .map((c: { type: 'text'; text: string }) => c.text)
      .join('\n');

    if (!isSandboxViolation(output, bashEvent.isError)) return;

    const approvalId = crypto.randomUUID();
    const timer = setTimeout(() => pendingApprovals.delete(approvalId), 30_000); // 30s per architecture doc
    pendingApprovals.set(approvalId, {
      approvalId,
      violationContext: output.slice(0, 200),
      createdAt: Date.now(),
      timer,
    });

    console.log('[sandbox-tools] Sandbox violation detected. approvalId:', approvalId);

    const escapeHatchText = [
      '',
      '[SANDBOX] This command was blocked by the sandbox.',
      'To request unsandboxed execution, use: /sandbox-allow <your reason>',
      'You will need to confirm this in the workwithme UI before it executes.',
    ].join('\n');

    // Return modified content — Pi SDK picks up the returned content array
    return {
      content: [...bashEvent.content, { type: 'text', text: escapeHatchText }],
    };
  });

  /** session_shutdown — clean up SandboxManager state */
  pi.on('session_shutdown', async () => {
    try {
      await SandboxManager.reset();
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * /sandbox-allow — agent slash command to request sandbox escape.
   * Looks up the most recent pending approval, sends SANDBOX_APPROVAL_REQUEST
   * over the active WS connection (wired via setSendToClient in server.ts).
   */
  pi.registerCommand('sandbox-allow', {
    description: 'Request approval to run a blocked command outside the sandbox',
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const reason = args?.trim() || 'No reason provided';

      // Pick the most recent pending approval
      const approvals = [...pendingApprovals.values()].sort((a, b) => b.createdAt - a.createdAt);
      const approval = approvals[0];

      if (!approval) {
        ctx.ui.notify('No pending sandbox violation to approve. Run the command first to trigger a violation.', 'warning');
        return;
      }

      if (_sendToClient) {
        _sendToClient({
          type: WS_EVENTS.SANDBOX_APPROVAL_REQUEST,
          approvalId: approval.approvalId,
          violationContext: approval.violationContext,
          reason,
        });
        ctx.ui.notify('Approval request sent. Please confirm in the workwithme UI. Once approved, retry the command.', 'info');
        return;
      }

      ctx.ui.notify('Unable to send approval request — no active session connection.', 'error');
    },
  });
}
