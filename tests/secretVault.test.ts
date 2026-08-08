import { describe, expect, it } from 'vitest';
import {
  MacOSKeychainVault,
  MemorySecretVault,
  WindowsCredentialVault,
  createPlatformSecretVault,
  type CommandRunner,
} from '../packages/secrets/src';

describe('OS credential vault adapters', () => {
  it('passes macOS secrets through stdin instead of process arguments', () => {
    const calls: Array<{ command: string; args: readonly string[]; input?: string }> = [];
    const run: CommandRunner = (command, args, input) => {
      calls.push({ command, args, input });
      if (args[0] === 'find-generic-password') return { status: 0, stdout: 'stored-value\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const vault = new MacOSKeychainVault('dev.jarvis.test', run);
    vault.set('openai.api-key', 'stored-value');
    expect(calls[0].args.join(' ')).not.toContain('stored-value');
    expect(calls[0].input).toBe('stored-value\nstored-value\n');
    expect(vault.get('openai.api-key')).toBe('stored-value');
  });

  it('treats a missing macOS Keychain item as unconfigured', () => {
    const vault = new MacOSKeychainVault('dev.jarvis.test', () => ({
      status: 44, stdout: '', stderr: 'not found',
    }));
    expect(vault.get('openai.api-key')).toBeNull();
    expect(vault.delete('openai.api-key')).toBe(false);
  });

  it('passes Windows secrets in stdin JSON and parses Credential Manager output', () => {
    const calls: Array<{ args: readonly string[]; input?: string }> = [];
    const run: CommandRunner = (_command, args, input) => {
      calls.push({ args, input });
      const request = JSON.parse(input ?? '{}') as { action?: string };
      return request.action === 'get'
        ? { status: 0, stdout: '{"ok":true,"found":true,"value":"stored-value"}', stderr: '' }
        : { status: 0, stdout: '{"ok":true,"deleted":true}', stderr: '' };
    };
    const vault = new WindowsCredentialVault('dev.jarvis.test', run);
    vault.set('openai.api-key', 'stored-value');
    expect(calls[0].args.join(' ')).not.toContain('stored-value');
    expect(calls[0].input).toContain('stored-value');
    expect(vault.get('openai.api-key')).toBe('stored-value');
    expect(vault.delete('openai.api-key')).toBe(true);
  });

  it('supports deterministic memory vaults for service tests', () => {
    const vault = new MemorySecretVault();
    vault.set('home-assistant.token', 'token');
    expect(vault.has('home-assistant.token')).toBe(true);
    expect(vault.get('home-assistant.token')).toBe('token');
    expect(vault.delete('home-assistant.token')).toBe(true);
    expect(vault.get('home-assistant.token')).toBeNull();
  });

  it('selects adapters by platform and fails closed for unsupported systems', () => {
    expect(createPlatformSecretVault({ platform: 'darwin' })).toBeInstanceOf(MacOSKeychainVault);
    expect(createPlatformSecretVault({ platform: 'win32' })).toBeInstanceOf(WindowsCredentialVault);
    expect(() => createPlatformSecretVault({ platform: 'aix' })).toThrow(/no OS credential-vault adapter/);
  });
});
