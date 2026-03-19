import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVICE = 'workwithme';

// ── macOS: security CLI ─────────────────────────────────────────────────────

async function macosGet(account: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password', '-s', SERVICE, '-a', account, '-w',
    ]);
    return stdout.trim() || null;
  } catch (err: any) {
    if (err.code === 44 || err.stderr?.includes('could not be found')) return null;
    throw err;
  }
}

async function macosSet(account: string, password: string): Promise<void> {
  await execFileAsync('security', [
    'add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', password,
  ]);
}

async function macosDelete(account: string): Promise<boolean> {
  try {
    await execFileAsync('security', [
      'delete-generic-password', '-s', SERVICE, '-a', account,
    ]);
    return true;
  } catch (err: any) {
    if (err.code === 44 || err.stderr?.includes('could not be found')) return false;
    throw err;
  }
}

// ── Linux: secret-tool CLI ──────────────────────────────────────────────────

async function linuxGet(account: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('secret-tool', [
      'lookup', 'service', SERVICE, 'account', account,
    ]);
    return stdout.trim() || null;
  } catch (err: any) {
    if (err.code === 1 || err.code === 'ENOENT') return null;
    throw err;
  }
}

async function linuxSet(account: string, password: string): Promise<void> {
  const child = execFile('secret-tool', [
    'store', '--label', `${SERVICE}/${account}`, 'service', SERVICE, 'account', account,
  ]);
  child.stdin!.end(password);
  await new Promise<void>((resolve, reject) => {
    child.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`secret-tool exited ${code}`))
    );
  });
}

async function linuxDelete(account: string): Promise<boolean> {
  // secret-tool clear exits 0 unconditionally, so check existence first
  try {
    await execFileAsync('secret-tool', [
      'lookup', 'service', SERVICE, 'account', account,
    ]);
  } catch (err: any) {
    if (err.code === 1 || err.code === 'ENOENT') return false;
    throw err;
  }
  // Secret exists — now clear it
  try {
    await execFileAsync('secret-tool', [
      'clear', 'service', SERVICE, 'account', account,
    ]);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

// ── Windows: PowerShell PasswordVault ──────────────────────────────────────
// Note: 'account' contains 'remote-mcp/<slug>' where slug is validated by the caller
// to match /^[a-z0-9][a-z0-9-]{0,62}$/ — no shell-unsafe characters.
// Passwords are passed via base64 + -EncodedCommand to avoid quoting issues.

function encodePSCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function windowsGet(account: string): Promise<string | null> {
  const script = `
    Add-Type -AssemblyName System.Security;
    $vault = New-Object Windows.Security.Credentials.PasswordVault;
    try {
      $cred = $vault.Retrieve('${SERVICE}', '${account}');
      $cred.RetrievePassword();
      Write-Output $cred.Password
    } catch { Write-Output '' }
  `;
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-EncodedCommand', encodePSCommand(script),
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function windowsSet(account: string, password: string): Promise<void> {
  // Encode password as base64 to avoid quoting/injection issues
  const b64password = Buffer.from(password, 'utf8').toString('base64');
  const script = `
    Add-Type -AssemblyName System.Security;
    $vault = New-Object Windows.Security.Credentials.PasswordVault;
    $pw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64password}'));
    $vault.Add([Windows.Security.Credentials.PasswordCredential]::new('${SERVICE}', '${account}', $pw))
  `;
  await execFileAsync('powershell', ['-NoProfile', '-EncodedCommand', encodePSCommand(script)]);
}

async function windowsDelete(account: string): Promise<boolean> {
  const script = `
    Add-Type -AssemblyName System.Security;
    $vault = New-Object Windows.Security.Credentials.PasswordVault;
    try {
      $vault.Remove($vault.Retrieve('${SERVICE}', '${account}')); Write-Output 'ok'
    } catch { Write-Output 'notfound' }
  `;
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-EncodedCommand', encodePSCommand(script),
    ]);
    return stdout.trim() === 'ok';
  } catch {
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function keychainGet(slug: string): Promise<string | null> {
  const account = `remote-mcp/${slug}`;
  switch (process.platform) {
    case 'darwin': return macosGet(account);
    case 'linux':  return linuxGet(account);
    case 'win32':  return windowsGet(account);
    default:
      console.warn(`[keychain] unsupported platform: ${process.platform}`);
      return null;
  }
}

export async function keychainSet(slug: string, token: string): Promise<void> {
  const account = `remote-mcp/${slug}`;
  switch (process.platform) {
    case 'darwin': return macosSet(account, token);
    case 'linux':  return linuxSet(account, token);
    case 'win32':  return windowsSet(account, token);
    default:
      console.warn(`[keychain] unsupported platform: ${process.platform}`);
  }
}

export async function keychainDelete(slug: string): Promise<boolean> {
  const account = `remote-mcp/${slug}`;
  switch (process.platform) {
    case 'darwin': return macosDelete(account);
    case 'linux':  return linuxDelete(account);
    case 'win32':  return windowsDelete(account);
    default:
      console.warn(`[keychain] unsupported platform: ${process.platform}`);
      return false;
  }
}
