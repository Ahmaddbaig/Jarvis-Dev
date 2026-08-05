import fs from 'node:fs';
import path from 'node:path';
import { migrateLegacyJson } from '@jarvis/persistence';
import type { GoogleServiceId } from '../../shared/google-services';
import { getCoreStore } from '../persistence/core-store';
import {
  GOOGLE_CREDENTIALS_DIR,
  GOOGLE_CREDENTIALS_PATH,
  LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH,
} from '../mcp/dynamic-config';
import { getGoogleTokenPath } from '../mcp/google-service-runtime';
import {
  getCredentialService,
  type VaultSecretDefinition,
} from './credential-service';

export const GOOGLE_OAUTH_CLIENT_SECRET: VaultSecretDefinition = {
  id: 'credential.google.oauth-client',
  integration: 'google',
  account: 'google.oauth-client-json',
};

let legacyCredentialsChecked = false;

export interface GoogleOAuthClientInfo {
  readonly projectId: string | null;
  readonly clientIdPrefix: string;
}

function parseGoogleOAuthCredentials(value: unknown): {
  normalized: string;
  info: GoogleOAuthClientInfo;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Google OAuth credentials must be a JSON object.');
  }
  const installed = (value as { installed?: unknown }).installed;
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) {
    throw new Error('Google OAuth credentials must contain an installed application definition.');
  }
  const client = installed as Record<string, unknown>;
  if (typeof client.client_id !== 'string' || !client.client_id) {
    throw new Error('Google OAuth client_id is missing.');
  }
  if (typeof client.client_secret !== 'string' || !client.client_secret) {
    throw new Error('Google OAuth client_secret is missing.');
  }
  return {
    normalized: JSON.stringify(value),
    info: {
      projectId: typeof client.project_id === 'string' ? client.project_id : null,
      clientIdPrefix: client.client_id.slice(0, 20),
    },
  };
}

function removeLegacyCredentialFile(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function migrateLegacyGoogleCredentials(): void {
  if (legacyCredentialsChecked) return;
  const store = getCoreStore();
  const credentials = getCredentialService();
  const candidates = [
    { id: 'google-shared-oauth-credentials-v1', filePath: GOOGLE_CREDENTIALS_PATH },
    { id: 'google-calendar-oauth-credentials-v1', filePath: LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH },
  ];

  for (const candidate of candidates) {
    const result = migrateLegacyJson({
      database: store.database,
      sourceId: candidate.id,
      sourcePath: candidate.filePath,
      backupDirectory: path.join(store.dataDirectory, 'migration-backups'),
      quarantineDirectory: path.join(store.dataDirectory, 'migration-quarantine'),
      importRecord: (record) => {
        const parsed = parseGoogleOAuthCredentials(record);
        if (!credentials.getSecret(GOOGLE_OAUTH_CLIENT_SECRET)) {
          credentials.setSecret(GOOGLE_OAUTH_CLIENT_SECRET, parsed.normalized, { kind: 'oauth-client' });
        }
      },
    });
    if (result.state === 'imported') removeLegacyCredentialFile(candidate.filePath);
  }
  legacyCredentialsChecked = true;
}

export function saveGoogleOAuthCredentials(content: string): GoogleOAuthClientInfo {
  if (!content || content.length > 1_000_000) throw new Error('Google credentials must be between 1 byte and 1 MB.');
  const parsed = parseGoogleOAuthCredentials(JSON.parse(content) as unknown);
  getCredentialService().setSecret(GOOGLE_OAUTH_CLIENT_SECRET, parsed.normalized, { kind: 'oauth-client' });
  removeLegacyCredentialFile(GOOGLE_CREDENTIALS_PATH);
  removeLegacyCredentialFile(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH);
  return parsed.info;
}

export function googleOAuthClientInfo(): GoogleOAuthClientInfo | null {
  migrateLegacyGoogleCredentials();
  const content = getCredentialService().getSecret(GOOGLE_OAUTH_CLIENT_SECRET);
  return content ? parseGoogleOAuthCredentials(JSON.parse(content) as unknown).info : null;
}

export function materializeGoogleOAuthCredentials(): string {
  migrateLegacyGoogleCredentials();
  const content = getCredentialService().getSecret(GOOGLE_OAUTH_CLIENT_SECRET);
  if (!content) throw new Error('Google OAuth credentials are not configured.');
  fs.mkdirSync(GOOGLE_CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(GOOGLE_CREDENTIALS_DIR, 0o700); } catch { /* Windows has no POSIX mode */ }
  const temporary = `${GOOGLE_CREDENTIALS_PATH}.${process.pid}.partial`;
  fs.writeFileSync(temporary, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, GOOGLE_CREDENTIALS_PATH);
  try { fs.chmodSync(GOOGLE_CREDENTIALS_PATH, 0o600); } catch { /* best effort on Windows */ }
  return GOOGLE_CREDENTIALS_PATH;
}

export function removeMaterializedGoogleOAuthCredentials(): void {
  removeLegacyCredentialFile(GOOGLE_CREDENTIALS_PATH);
}

export function deleteGoogleOAuthCredentials(): boolean {
  removeMaterializedGoogleOAuthCredentials();
  removeLegacyCredentialFile(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH);
  return getCredentialService().deleteSecret(GOOGLE_OAUTH_CLIENT_SECRET);
}

function googleTokenReference(serviceId: GoogleServiceId): VaultSecretDefinition {
  return {
    id: `credential.google.${serviceId}.provider-token`,
    integration: 'google',
    account: `google.${serviceId}.provider-token`,
  };
}

export function googleServiceAuthenticated(serviceId: GoogleServiceId): boolean {
  const tokenPath = getGoogleTokenPath(serviceId);
  if (!fs.existsSync(tokenPath)) {
    getCoreStore().database.secretRefs.delete(googleTokenReference(serviceId).id);
    return false;
  }
  const directory = path.dirname(tokenPath);
  try {
    fs.chmodSync(directory, 0o700);
    fs.chmodSync(tokenPath, 0o600);
  } catch { /* best effort on Windows */ }
  const reference = googleTokenReference(serviceId);
  getCoreStore().database.secretRefs.put({
    id: reference.id,
    integration: reference.integration,
    vaultService: 'provider-protected-file',
    vaultAccount: reference.account,
    metadata: { serviceId, kind: 'oauth-token' },
  });
  return true;
}
