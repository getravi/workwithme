import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'node:child_process';

// Provide a factory mock so execFile is a plain vi.fn() WITHOUT the
// util.promisify.custom symbol. The auto-mock copies that symbol from the real
// execFile, which causes promisify(execFile) to bypass our mockImplementation.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const { execFile } = vi.mocked(childProcess);

// Helper: resolve the last function argument as the Node-style callback.
// promisify(execFile) calls execFile(cmd, args, options, callback) so the
// callback is always the last argument regardless of position.
function lastCb(args: any[]): ((err: any, result: any) => void) | undefined {
  const last = args[args.length - 1];
  return typeof last === 'function' ? last : undefined;
}

// Helper: make execFile call its callback with the given result (success path)
function mockExecSuccess(stdout = '') {
  execFile.mockImplementation((...args: any[]) => {
    const cb = lastCb(args);
    if (cb) cb(null, { stdout, stderr: '' });
    return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
  });
}

// Helper: make execFile call its callback with an error
function mockExecError(code: number | string, stderr = '') {
  execFile.mockImplementation((...args: any[]) => {
    const err: any = new Error(`exit ${code}`);
    err.code = code;
    err.stderr = stderr;
    const cb = lastCb(args);
    if (cb) cb(err, null);
    return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
  });
}

import { keychainGet, keychainSet, keychainDelete } from './keychain.js';

describe('keychain (macOS)', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    execFile.mockReset();
  });

  describe('keychainGet', () => {
    it('calls security find-generic-password and returns trimmed token', async () => {
      mockExecSuccess('tok_123\n');
      const result = await keychainGet('stripe');
      expect(execFile).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'workwithme', '-a', 'remote-mcp/stripe', '-w'],
        expect.any(Function)
      );
      expect(result).toBe('tok_123');
    });

    it('returns null for exit code 44 (not found)', async () => {
      mockExecError(44);
      expect(await keychainGet('stripe')).toBeNull();
    });

    it('returns null when stderr contains "could not be found"', async () => {
      execFile.mockImplementation((...args: any[]) => {
        const err: any = new Error('not found');
        err.code = 1;
        err.stderr = 'security: SecKeychainSearchCopyNext: The specified item could not be found.';
        const cb = lastCb(args);
        if (cb) cb(err, null);
        return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
      });
      expect(await keychainGet('stripe')).toBeNull();
    });

    it('re-throws unexpected errors (not exit 44, not "could not be found")', async () => {
      execFile.mockImplementation((_cmd: any, _args: any, cb?: any) => {
        const err: any = new Error('permission denied');
        err.code = 1;
        err.stderr = 'errSecAuthFailed';
        if (cb) cb(err, null);
        return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
      });
      await expect(keychainGet('stripe')).rejects.toThrow('permission denied');
    });
  });

  describe('keychainSet', () => {
    it('calls security add-generic-password with -U flag', async () => {
      mockExecSuccess();
      await keychainSet('stripe', 'tok_secret');
      expect(execFile).toHaveBeenCalledWith(
        'security',
        ['add-generic-password', '-U', '-s', 'workwithme', '-a', 'remote-mcp/stripe', '-w', 'tok_secret'],
        expect.any(Function)
      );
    });
  });

  describe('keychainDelete', () => {
    it('returns true when item deleted', async () => {
      mockExecSuccess();
      expect(await keychainDelete('stripe')).toBe(true);
      expect(execFile).toHaveBeenCalledWith(
        'security',
        ['delete-generic-password', '-s', 'workwithme', '-a', 'remote-mcp/stripe'],
        expect.any(Function)
      );
    });

    it('returns false for exit code 44 (not found)', async () => {
      mockExecError(44);
      expect(await keychainDelete('stripe')).toBe(false);
    });

    it('re-throws unexpected errors (not exit 44, not "could not be found")', async () => {
      execFile.mockImplementation((_cmd: any, _args: any, cb?: any) => {
        const err: any = new Error('keychain locked');
        err.code = 1;
        err.stderr = 'errSecInteractionRequired';
        if (cb) cb(err, null);
        return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
      });
      await expect(keychainDelete('stripe')).rejects.toThrow('keychain locked');
    });
  });
});

describe('keychain (Linux)', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    execFile.mockReset();
  });

  describe('keychainGet', () => {
    it('calls secret-tool lookup and returns token', async () => {
      mockExecSuccess('tok_linux\n');
      expect(await keychainGet('stripe')).toBe('tok_linux');
      expect(execFile).toHaveBeenCalledWith(
        'secret-tool',
        ['lookup', 'service', 'workwithme', 'account', 'remote-mcp/stripe'],
        expect.any(Function)
      );
    });

    it('returns null when secret-tool exits 1 (not found)', async () => {
      mockExecError(1);
      expect(await keychainGet('stripe')).toBeNull();
    });

    it('returns null when secret-tool not installed (ENOENT)', async () => {
      mockExecError('ENOENT');
      expect(await keychainGet('stripe')).toBeNull();
    });
  });

  describe('keychainSet', () => {
    it('writes password to stdin of secret-tool store', async () => {
      const stdinEndMock = vi.fn();
      const onMock = vi.fn((event: string, cb: Function) => {
        if (event === 'close') cb(0);
      });
      execFile.mockReturnValue({ stdin: { end: stdinEndMock }, on: onMock } as any);
      await keychainSet('stripe', 'tok_secret');
      expect(execFile).toHaveBeenCalledWith(
        'secret-tool',
        ['store', '--label', 'workwithme/remote-mcp/stripe', 'service', 'workwithme', 'account', 'remote-mcp/stripe']
      );
      expect(stdinEndMock).toHaveBeenCalledWith('tok_secret');
    });
  });

  describe('keychainDelete', () => {
    it('returns true when key exists (lookup succeeds, clear succeeds)', async () => {
      // First call: lookup (success), Second call: clear (success)
      execFile
        .mockImplementationOnce((...args: any[]) => {
          const cb = lastCb(args);
          if (cb) cb(null, { stdout: 'tok', stderr: '' });
          return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
        })
        .mockImplementationOnce((...args: any[]) => {
          const cb = lastCb(args);
          if (cb) cb(null, { stdout: '', stderr: '' });
          return { stdin: { end: vi.fn() }, on: vi.fn() } as any;
        });
      expect(await keychainDelete('stripe')).toBe(true);
      expect(execFile).toHaveBeenCalledTimes(2);
      expect(execFile).toHaveBeenNthCalledWith(
        1,
        'secret-tool',
        ['lookup', 'service', 'workwithme', 'account', 'remote-mcp/stripe'],
        expect.any(Function)
      );
      expect(execFile).toHaveBeenNthCalledWith(
        2,
        'secret-tool',
        ['clear', 'service', 'workwithme', 'account', 'remote-mcp/stripe'],
        expect.any(Function)
      );
    });

    it('returns false when key not found (lookup exits 1)', async () => {
      mockExecError(1);
      expect(await keychainDelete('stripe')).toBe(false);
      expect(execFile).toHaveBeenCalledTimes(1); // only lookup, no clear
    });

    it('returns false when secret-tool not installed (ENOENT)', async () => {
      mockExecError('ENOENT');
      expect(await keychainDelete('stripe')).toBe(false);
    });
  });
});

describe('keychain (unsupported platform)', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'freebsd' });
  });

  it('keychainGet returns null and logs warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await keychainGet('stripe')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported platform'));
    warnSpy.mockRestore();
  });

  it('keychainDelete returns false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await keychainDelete('stripe')).toBe(false);
    warnSpy.mockRestore();
  });
});
