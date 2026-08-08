export {
  LinuxSecretServiceVault,
  MacOSKeychainVault,
  MemorySecretVault,
  WindowsCredentialVault,
  createPlatformSecretVault,
  runCredentialCommand,
} from './vault';
export type {
  VaultCommandResult,
  CommandRunner,
  PlatformVaultOptions,
  SecretVault,
} from './vault';
