export {
  LinuxSecretServiceVault,
  MacOSKeychainVault,
  MemorySecretVault,
  WindowsCredentialVault,
  createPlatformSecretVault,
  runCredentialCommand,
} from './vault';
export type {
  CommandResult,
  CommandRunner,
  PlatformVaultOptions,
  SecretVault,
} from './vault';
