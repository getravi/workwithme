import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';

// Mirror of the validation helpers in server.ts.
// If these are ever extracted to a shared module, import directly instead.

const homeDir = os.homedir();

function validateProjectPath(rawPath: string): string | null {
  const resolved = path.resolve(rawPath);
  if (!resolved.startsWith(homeDir + path.sep) && resolved !== homeDir) {
    return 'Path must be within your home directory';
  }
  return null;
}

function validateSessionPath(rawPath: string): string | null {
  const resolved = path.resolve(rawPath);
  const sessionDir = path.join(homeDir, '.pi');
  if (!resolved.startsWith(sessionDir + path.sep) && resolved !== sessionDir) {
    return 'Invalid session path';
  }
  return null;
}

describe('validateProjectPath', () => {
  it('accepts a path inside homedir', () => {
    expect(validateProjectPath(path.join(homeDir, 'projects/foo'))).toBeNull();
  });

  it('rejects a path outside homedir', () => {
    expect(validateProjectPath('/etc/passwd')).toMatch(/home directory/);
  });

  it('rejects /tmp traversal', () => {
    expect(validateProjectPath('/tmp/evil')).toMatch(/home directory/);
  });

  it('accepts homeDir itself', () => {
    expect(validateProjectPath(homeDir)).toBeNull();
  });

  it('rejects path traversal via ../..', () => {
    const traversal = path.join(homeDir, 'projects/../../etc');
    expect(validateProjectPath(traversal)).toMatch(/home directory/);
  });

  it('rejects root /', () => {
    expect(validateProjectPath('/')).toMatch(/home directory/);
  });
});

describe('validateSessionPath', () => {
  it('accepts a path inside ~/.pi', () => {
    expect(validateSessionPath(path.join(homeDir, '.pi/sessions/foo.json'))).toBeNull();
  });

  it('rejects a path outside ~/.pi', () => {
    expect(validateSessionPath(path.join(homeDir, 'projects/foo'))).toMatch(/Invalid/);
  });

  it('rejects /etc/passwd', () => {
    expect(validateSessionPath('/etc/passwd')).toMatch(/Invalid/);
  });

  it('rejects path traversal via ../..', () => {
    const traversal = path.join(homeDir, '.pi/../../etc');
    expect(validateSessionPath(traversal)).toMatch(/Invalid/);
  });

  it('accepts the ~/.pi directory itself', () => {
    expect(validateSessionPath(path.join(homeDir, '.pi'))).toBeNull();
  });
});
