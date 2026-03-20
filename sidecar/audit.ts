import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const AUDIT_LOG_PATH = join(homedir(), '.pi', 'audit.log');

// Ensure parent directory exists (best-effort)
try { mkdirSync(dirname(AUDIT_LOG_PATH), { recursive: true }); } catch {}

/**
 * Appends a structured audit log entry to ~/.pi/audit.log.
 * Non-fatal: logs a warning but never throws.
 */
export function auditLog(event: string, details: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...details });
  try {
    appendFileSync(AUDIT_LOG_PATH, entry + '\n');
  } catch (err) {
    console.warn('[audit] Failed to write audit log:', err);
  }
}
