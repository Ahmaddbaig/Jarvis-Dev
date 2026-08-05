import type { CredentialKey, CredentialPatch, CredentialStatus } from '@jarvis/contracts';
import type { JarvisDatabase } from '@jarvis/persistence';
import { createPlatformSecretVault, type SecretVault } from '@jarvis/secrets';
import { getCoreStore } from '../persistence/core-store';
import { migrateLegacyCredentials } from './legacy-credentials';

export const JARVIS_VAULT_SERVICE = 'dev.jarvis.credentials';

export interface VaultSecretDefinition {
  readonly id: string;
  readonly integration: string;
  readonly account: string;
}

const CREDENTIAL_DEFINITIONS: Record<CredentialKey, VaultSecretDefinition> = {
  openaiApiKey: {
    id: 'credential.openai.api-key',
    integration: 'openai',
    account: 'openai.api-key',
  },
  anthropicApiKey: {
    id: 'credential.anthropic.api-key',
    integration: 'anthropic',
    account: 'anthropic.api-key',
  },
  homeAssistantToken: {
    id: 'credential.home-assistant.token',
    integration: 'home-assistant',
    account: 'home-assistant.token',
  },
  icalFeedUrl: {
    id: 'credential.ical.feed-url',
    integration: 'calendar',
    account: 'ical.feed-url',
  },
};

const CREDENTIAL_KEYS = Object.keys(CREDENTIAL_DEFINITIONS) as CredentialKey[];

export class CredentialService {
  constructor(
    private readonly database: JarvisDatabase,
    private readonly vault: SecretVault,
    private readonly vaultService = JARVIS_VAULT_SERVICE,
  ) {}

  set(key: CredentialKey, value: string): void {
    const definition = CREDENTIAL_DEFINITIONS[key];
    if (!definition) throw new Error(`Unknown credential ${String(key)}.`);
    this.setSecret(definition, value, { key });
  }

  setSecret(
    definition: VaultSecretDefinition,
    value: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): void {
    if (!value) throw new Error('Credential values must not be empty.');
    const previous = this.vault.get(definition.account);
    this.vault.set(definition.account, value);
    try {
      if (this.vault.get(definition.account) !== value) {
        throw new Error(`Credential ${definition.id} failed vault read-back verification.`);
      }
      this.database.secretRefs.put({
        id: definition.id,
        integration: definition.integration,
        vaultService: this.vaultService,
        vaultAccount: definition.account,
        metadata,
      });
    } catch (error) {
      if (previous === null) this.vault.delete(definition.account);
      else this.vault.set(definition.account, previous);
      throw error;
    }
  }

  setMany(patch: CredentialPatch): void {
    const written: CredentialKey[] = [];
    const previous = new Map<CredentialKey, string | null>();
    try {
      for (const key of CREDENTIAL_KEYS) {
        const value = patch[key];
        if (value === undefined) continue;
        previous.set(key, this.get(key));
        this.set(key, value);
        written.push(key);
      }
    } catch (error) {
      for (const key of written.reverse()) {
        const oldValue = previous.get(key);
        if (oldValue === null || oldValue === undefined) this.delete(key);
        else this.set(key, oldValue);
      }
      throw error;
    }
  }

  get(key: CredentialKey): string | null {
    const definition = CREDENTIAL_DEFINITIONS[key];
    return this.getSecret(definition);
  }

  getSecret(definition: VaultSecretDefinition): string | null {
    const reference = this.database.secretRefs.get(definition.id);
    if (!reference || reference.vaultService !== this.vaultService) return null;
    return this.vault.get(reference.vaultAccount);
  }

  delete(key: CredentialKey): boolean {
    const definition = CREDENTIAL_DEFINITIONS[key];
    return this.deleteSecret(definition);
  }

  deleteSecret(definition: VaultSecretDefinition): boolean {
    const reference = this.database.secretRefs.get(definition.id);
    const deletedFromVault = reference ? this.vault.delete(reference.vaultAccount) : false;
    const deletedReference = this.database.secretRefs.delete(definition.id);
    return deletedFromVault || deletedReference;
  }

  status(): CredentialStatus {
    return Object.fromEntries(CREDENTIAL_KEYS.map((key) => [key, this.get(key) !== null])) as CredentialStatus;
  }
}

declare global {
  var __jarvisCredentialService: CredentialService | undefined;
}

export function getCredentialService(): CredentialService {
  if (!globalThis.__jarvisCredentialService) {
    const store = getCoreStore();
    const service = new CredentialService(
      store.database,
      createPlatformSecretVault({ service: JARVIS_VAULT_SERVICE }),
    );
    globalThis.__jarvisCredentialService = service;
    migrateLegacyCredentials(store, service);
  }
  return globalThis.__jarvisCredentialService;
}
