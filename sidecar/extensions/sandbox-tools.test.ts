import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sandbox/SandboxService.js', () => ({
  SandboxService: {
    isSupported: true,
    srtAvailable: true,
    createSandboxedBashOps: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({ exitCode: 0 })
    }),
  }
}));

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: { reset: vi.fn().mockResolvedValue(undefined) }
}));

describe('sandbox-tools extension', () => {
  let pi: any;
  let handlers: Record<string, Function>;
  let commands: Record<string, { handler: Function }>;
  let mod: typeof import('./sandbox-tools.js');

  beforeEach(async () => {
    vi.resetModules();
    handlers = {};
    commands = {};
    pi = {
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
      registerCommand: vi.fn().mockImplementation((name: string, def: { handler: Function }) => {
        commands[name] = def;
      }),
    };

    mod = await import('./sandbox-tools.js');
    mod.default(pi);
  });

  it('registers user_bash, tool_result, and session_shutdown handlers', () => {
    expect(handlers['user_bash']).toBeDefined();
    expect(handlers['tool_result']).toBeDefined();
    expect(handlers['session_shutdown']).toBeDefined();
  });

  it('user_bash wraps with sandboxed ops when bypass flag is not set', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = true;

    const result = await handlers['user_bash']({});
    expect(result).toHaveProperty('operations');
    expect(SandboxService.createSandboxedBashOps).toHaveBeenCalledWith('agent');
  });

  it('user_bash returns undefined when isSupported is false', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = false;

    const result = await handlers['user_bash']({});
    expect(result).toBeUndefined();
  });

  it('user_bash returns undefined (bypasses sandbox) after grantApproval is called', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = true;

    mod.grantApproval('test-approval-id');

    const result = await handlers['user_bash']({});
    expect(result).toBeUndefined();

    const result2 = await handlers['user_bash']({});
    expect(result2).toHaveProperty('operations');
  });

  it('tool_result: isSandboxViolation returns false for exit code 0', async () => {
    const event = { toolName: 'bash', output: 'Sandbox: deny', exitCode: 0, result: 'output' };
    await handlers['tool_result'](event);
    expect(event.result).toBe('output');
  });

  it('tool_result: detects violation and appends escape hatch message', async () => {
    const event = {
      toolName: 'bash',
      output: 'Operation not permitted',
      exitCode: 1,
      result: 'original output',
    };
    await handlers['tool_result'](event);
    expect(event.result).toContain('[SANDBOX]');
    expect(event.result).toContain('/sandbox-allow');
  });

  it('tool_result: non-bash tool is ignored', async () => {
    const event = { toolName: 'read_file', output: 'Operation not permitted', exitCode: 1, result: 'x' };
    await handlers['tool_result'](event);
    expect(event.result).toBe('x');
  });

  it('/sandbox-allow: calls sendToClient when pending approval exists', async () => {
    const sendToClient = vi.fn();
    mod.setSendToClient(sendToClient);

    const event = {
      toolName: 'bash',
      output: 'Sandbox: deny file read',
      exitCode: 1,
      result: 'Sandbox: deny',
    };
    await handlers['tool_result'](event);

    const returnMsg = await commands['sandbox-allow'].handler('need network access');
    expect(sendToClient).toHaveBeenCalledOnce();
    const call = sendToClient.mock.calls[0][0];
    expect(call.type).toBe('sandbox_approval_request');
    expect(call.approvalId).toBeTruthy();
    expect(call.reason).toBe('need network access');
    expect(returnMsg).toContain('Approval request sent');
  });

  it('/sandbox-allow: returns "no pending" message when no violations', async () => {
    const sendToClient = vi.fn();
    mod.setSendToClient(sendToClient);

    const returnMsg = await commands['sandbox-allow'].handler('reason');
    expect(sendToClient).not.toHaveBeenCalled();
    expect(returnMsg).toContain('No pending');
  });

  it('grantApproval sets bypass flag', async () => {
    const { SandboxService } = await import('../sandbox/SandboxService.js');
    (SandboxService as any).isSupported = true;

    mod.grantApproval('some-id');

    // bypassNextCall should now be true — verified indirectly: next user_bash returns undefined
    const result = await handlers['user_bash']({});
    expect(result).toBeUndefined();
  });

  it('tool_result stores pending approval with command info', async () => {
    const sendToClient = vi.fn();
    mod.setSendToClient(sendToClient);

    const event = {
      toolName: 'bash',
      output: 'Sandbox: deny file read',
      exitCode: 1,
      result: 'Sandbox: deny',
    };
    await handlers['tool_result'](event);

    // pendingApprovals is not exported — verify indirectly via /sandbox-allow
    await commands['sandbox-allow'].handler('need access');
    expect(sendToClient).toHaveBeenCalledOnce();
    const call = sendToClient.mock.calls[0][0];
    expect(call).toHaveProperty('approvalId');
    expect(call).toHaveProperty('violationContext');
  });

  it('session_shutdown calls SandboxManager.reset', async () => {
    const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
    await handlers['session_shutdown']();
    expect(SandboxManager.reset).toHaveBeenCalled();
  });
});
