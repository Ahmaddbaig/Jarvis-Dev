import {
  credentialPatchSchema,
  type CredentialPatch,
} from '@jarvis/contracts';
import { migrateLegacyJson } from '@jarvis/persistence';
import type { CoreStore } from '../persistence/core-store';
import type { CredentialService } from './credential-service';

const LEGACY_SECRET_SOURCE_ID = 'jarvis-legacy-secrets-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function credentialPatchFromLegacySettings(
  record: Readonly<Record<string, unknown>>,
): CredentialPatch {
  const candidate: Record<string, unknown> = {};
  if (typeof record.jarvis_ha_token === 'string' && record.jarvis_ha_token) {
    candidate.homeAssistantToken = record.jarvis_ha_token;
  }
  if (typeof record.jarvis_ical_url === 'string' && record.jarvis_ical_url) {
    candidate.icalFeedUrl = record.jarvis_ical_url;
  }
  if (typeof record.jarvis_settings === 'string') {
    const parsed = JSON.parse(record.jarvis_settings) as unknown;
    if (!isRecord(parsed)) throw new Error('Legacy jarvis_settings must contain a JSON object.');
    if (typeof parsed.apiKey === 'string' && parsed.apiKey) candidate.openaiApiKey = parsed.apiKey;
    if (typeof parsed.claudeApiKey === 'string' && parsed.claudeApiKey) {
      candidate.anthropicApiKey = parsed.claudeApiKey;
    }
  }
  return credentialPatchSchema.parse(candidate);
}

export function migrateLegacyCredentials(store: CoreStore, credentials: CredentialService): void {
  const result = migrateLegacyJson({
    database: store.database,
    sourceId: LEGACY_SECRET_SOURCE_ID,
    sourcePath: store.legacySettingsPath,
    backupDirectory: `${store.dataDirectory}/migration-backups`,
    quarantineDirectory: `${store.dataDirectory}/migration-quarantine`,
    importRecord: (record) => credentials.setMany(credentialPatchFromLegacySettings(record)),
  });
  if (result.state === 'imported' && !result.alreadyProcessed) store.removeLegacyCredentialValues();
}
