import { spawnSync } from 'node:child_process';

export interface SecretVault {
  set(account: string, value: string): void;
  get(account: string): string | null;
  delete(account: string): boolean;
  has(account: string): boolean;
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export type CommandRunner = (command: string, args: readonly string[], input?: string) => CommandResult;

export const runCredentialCommand: CommandRunner = (command, args, input) => {
  const result = spawnSync(command, [...args], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1_048_576,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ...(result.error ? { error: result.error } : {}),
  };
};

function assertIdentifier(label: string, value: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) {
    throw new Error(`${label} must be a safe identifier containing 1-128 characters.`);
  }
}

function assertSecret(value: string): void {
  if (!value || value.length > 8_192) throw new Error('Secret values must contain 1-8192 characters.');
  if (value.includes('\0')) throw new Error('Secret values cannot contain null bytes.');
}

function commandFailure(operation: string, result: CommandResult): Error {
  const detail = result.error?.message || result.stderr.trim() || `exit status ${String(result.status)}`;
  return new Error(`Credential vault ${operation} failed: ${detail}`);
}

export class MacOSKeychainVault implements SecretVault {
  constructor(
    private readonly service: string,
    private readonly run: CommandRunner = runCredentialCommand,
  ) {
    assertIdentifier('Vault service', service);
  }

  set(account: string, value: string): void {
    assertIdentifier('Vault account', account);
    assertSecret(value);
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error('macOS Keychain values must be single-line strings.');
    }
    const result = this.run('/usr/bin/security', [
      'add-generic-password', '-U', '-a', account, '-s', this.service, '-w',
    ], `${value}\n${value}\n`);
    if (result.status !== 0) throw commandFailure('write', result);
  }

  get(account: string): string | null {
    assertIdentifier('Vault account', account);
    const result = this.run('/usr/bin/security', [
      'find-generic-password', '-a', account, '-s', this.service, '-w',
    ]);
    if (result.status === 44) return null;
    if (result.status !== 0) throw commandFailure('read', result);
    return result.stdout.replace(/[\r\n]+$/, '');
  }

  delete(account: string): boolean {
    assertIdentifier('Vault account', account);
    const result = this.run('/usr/bin/security', [
      'delete-generic-password', '-a', account, '-s', this.service,
    ]);
    if (result.status === 44) return false;
    if (result.status !== 0) throw commandFailure('delete', result);
    return true;
  }

  has(account: string): boolean {
    return this.get(account) !== null;
  }
}

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class JarvisCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll", SetLastError = false)]
  private static extern void CredFree(IntPtr credential);

  public static void Write(string target, string account, string secret) {
    byte[] bytes = Encoding.Unicode.GetBytes(secret);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      CREDENTIAL credential = new CREDENTIAL {
        Type = 1,
        TargetName = target,
        UserName = account,
        CredentialBlob = blob,
        CredentialBlobSize = (UInt32)bytes.Length,
        Persist = 2
      };
      if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      for (int index = 0; index < bytes.Length; index++) bytes[index] = 0;
      Marshal.FreeHGlobal(blob);
    }
  }

  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return null;
      throw new Win32Exception(error);
    }
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
    } finally {
      CredFree(pointer);
    }
  }

  public static bool Delete(string target) {
    if (CredDelete(target, 1, 0)) return true;
    int error = Marshal.GetLastWin32Error();
    if (error == 1168) return false;
    throw new Win32Exception(error);
  }
}
'@

$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = "$($request.service)/$($request.account)"
if ($request.action -eq 'set') {
  [JarvisCredentialManager]::Write($target, $request.account, $request.value)
  @{ ok = $true } | ConvertTo-Json -Compress
} elseif ($request.action -eq 'get') {
  $value = [JarvisCredentialManager]::Read($target)
  @{ ok = $true; found = $null -ne $value; value = $value } | ConvertTo-Json -Compress
} elseif ($request.action -eq 'delete') {
  @{ ok = $true; deleted = [JarvisCredentialManager]::Delete($target) } | ConvertTo-Json -Compress
} else {
  throw 'Unsupported credential action.'
}
`;

interface WindowsResponse {
  ok?: boolean;
  found?: boolean;
  value?: string | null;
  deleted?: boolean;
}

export class WindowsCredentialVault implements SecretVault {
  private readonly encodedScript = Buffer.from(WINDOWS_CREDENTIAL_SCRIPT, 'utf16le').toString('base64');

  constructor(
    private readonly service: string,
    private readonly run: CommandRunner = runCredentialCommand,
  ) {
    assertIdentifier('Vault service', service);
  }

  set(account: string, value: string): void {
    assertIdentifier('Vault account', account);
    assertSecret(value);
    if (Buffer.byteLength(value, 'utf16le') > 2_560) {
      throw new Error('Windows Credential Manager values cannot exceed 2560 bytes.');
    }
    this.invoke({ action: 'set', service: this.service, account, value });
  }

  get(account: string): string | null {
    assertIdentifier('Vault account', account);
    const response = this.invoke({ action: 'get', service: this.service, account });
    return response.found && typeof response.value === 'string' ? response.value : null;
  }

  delete(account: string): boolean {
    assertIdentifier('Vault account', account);
    return this.invoke({ action: 'delete', service: this.service, account }).deleted === true;
  }

  has(account: string): boolean {
    return this.get(account) !== null;
  }

  private invoke(request: Record<string, string>): WindowsResponse {
    const result = this.run('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', this.encodedScript,
    ], JSON.stringify(request));
    if (result.status !== 0) throw commandFailure('operation', result);
    try {
      const response = JSON.parse(result.stdout.trim()) as WindowsResponse;
      if (!response.ok) throw new Error('Credential Manager returned an unsuccessful result.');
      return response;
    } catch (error) {
      throw new Error('Credential Manager returned an invalid response.', { cause: error });
    }
  }
}

export class LinuxSecretServiceVault implements SecretVault {
  constructor(
    private readonly service: string,
    private readonly run: CommandRunner = runCredentialCommand,
  ) {
    assertIdentifier('Vault service', service);
  }

  set(account: string, value: string): void {
    assertIdentifier('Vault account', account);
    assertSecret(value);
    const result = this.run('secret-tool', [
      'store', '--label', `Jarvis ${account}`, 'service', this.service, 'account', account,
    ], value);
    if (result.status !== 0) throw commandFailure('write', result);
  }

  get(account: string): string | null {
    assertIdentifier('Vault account', account);
    const result = this.run('secret-tool', ['lookup', 'service', this.service, 'account', account]);
    if (result.status === 1) return null;
    if (result.status !== 0) throw commandFailure('read', result);
    return result.stdout.replace(/[\r\n]+$/, '');
  }

  delete(account: string): boolean {
    assertIdentifier('Vault account', account);
    if (!this.has(account)) return false;
    const result = this.run('secret-tool', ['clear', 'service', this.service, 'account', account]);
    if (result.status !== 0) throw commandFailure('delete', result);
    return true;
  }

  has(account: string): boolean {
    return this.get(account) !== null;
  }
}

export class MemorySecretVault implements SecretVault {
  private readonly values = new Map<string, string>();

  set(account: string, value: string): void {
    assertIdentifier('Vault account', account);
    assertSecret(value);
    this.values.set(account, value);
  }

  get(account: string): string | null {
    assertIdentifier('Vault account', account);
    return this.values.get(account) ?? null;
  }

  delete(account: string): boolean {
    assertIdentifier('Vault account', account);
    return this.values.delete(account);
  }

  has(account: string): boolean {
    return this.get(account) !== null;
  }
}

export interface PlatformVaultOptions {
  readonly service?: string;
  readonly platform?: NodeJS.Platform;
  readonly run?: CommandRunner;
}

export function createPlatformSecretVault(options: PlatformVaultOptions = {}): SecretVault {
  const service = options.service ?? 'dev.jarvis.credentials';
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return new MacOSKeychainVault(service, options.run);
  if (platform === 'win32') return new WindowsCredentialVault(service, options.run);
  if (platform === 'linux') return new LinuxSecretServiceVault(service, options.run);
  throw new Error(`Jarvis has no OS credential-vault adapter for ${platform}.`);
}
