import { describe, expect, it } from 'vitest';
import { CredentialService, JARVIS_VAULT_SERVICE } from '../backend/secrets/credential-service';
import { JarvisDatabase } from '../packages/persistence/src';
import { MemorySecretVault, type SecretVault } from '../packages/secrets/src';

describe('credential service', () => {
  it('stores values only in the vault and writes opaque SQLite references', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    const vault = new MemorySecretVault();
    const service = new CredentialService(database, vault);
    service.set('openaiApiKey', 'synthetic-secret');

    expect(service.get('openaiApiKey')).toBe('synthetic-secret');
    expect(service.status()).toMatchObject({ openaiApiKey: true, anthropicApiKey: false });
    const refs = database.secretRefs.list();
    expect(refs).toMatchObject([{
      id: 'credential.openai.api-key',
      integration: 'openai',
      vaultService: JARVIS_VAULT_SERVICE,
      vaultAccount: 'openai.api-key',
    }]);
    expect(JSON.stringify(refs)).not.toContain('synthetic-secret');
    database.close();
  });

  it('deletes the vault item and reference together', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    const service = new CredentialService(database, new MemorySecretVault());
    service.set('homeAssistantToken', 'ha-token');
    expect(service.delete('homeAssistantToken')).toBe(true);
    expect(service.get('homeAssistantToken')).toBeNull();
    expect(database.secretRefs.list()).toEqual([]);
    database.close();
  });

  it('removes a vault value when reference persistence fails', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    const memory = new MemorySecretVault();
    const vault: SecretVault = {
      set: (account, value) => memory.set(account, value),
      get: (account) => memory.get(account),
      delete: (account) => memory.delete(account),
      has: (account) => memory.has(account),
    };
    const service = new CredentialService(database, vault, 'not the configured service');
    expect(() => service.set('openaiApiKey', 'synthetic-secret')).toThrow(/safe identifier/);
    expect(memory.get('openai.api-key')).toBeNull();
    database.close();
  });

  it('supports opaque integration secrets without adding them to renderer status', () => {
    const database = new JarvisDatabase(':memory:', 'test');
    const service = new CredentialService(database, new MemorySecretVault());
    const definition = {
      id: 'credential.synthetic.session',
      integration: 'synthetic',
      account: 'synthetic.session',
    };
    service.setSecret(definition, 'opaque-session-value', { kind: 'session' });

    expect(service.getSecret(definition)).toBe('opaque-session-value');
    expect(service.status()).toEqual({
      openaiApiKey: false,
      anthropicApiKey: false,
      homeAssistantToken: false,
      icalFeedUrl: false,
    });
    expect(JSON.stringify(database.secretRefs.list())).not.toContain('opaque-session-value');
    expect(service.deleteSecret(definition)).toBe(true);
    database.close();
  });
});
