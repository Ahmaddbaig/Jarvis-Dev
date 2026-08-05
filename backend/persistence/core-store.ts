import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jarvisSettingsPatchSchema } from '@jarvis/contracts';
import { JarvisDatabase, migrateLegacyJson, type DatabaseDiagnostics } from '@jarvis/persistence';

const SERVER_SCOPE = 'server';
const LEGACY_SETTINGS_FILE = 'jarvis-server-settings.json';
const DATABASE_FILE = 'jarvis-core.sqlite3';
const LEGACY_SOURCE_ID = 'jarvis-server-settings-v1';
const MAX_SETTING_LENGTH = 1_048_576;

const NON_SECRET_SERVER_KEYS = new Set([
  'jarvis_ha_url',
  'jarvis_weather_location',
  'jarvis_weather_lat',
  'jarvis_weather_lon',
  'bambu_email',
  'bambu_token_exp',
  'jarvis_news_settings',
  'jarvis_voicebox_url',
]);

const SECRET_SERVER_KEYS = new Set([
  'jarvis_ha_token',
  'jarvis_ical_url',
]);

const ALL_SERVER_KEYS = new Set([
  'jarvis_settings',
  ...NON_SECRET_SERVER_KEYS,
  ...SECRET_SERVER_KEYS,
]);

type SettingsRecord = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(key: string, value: unknown): string {
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
  if (value.length > MAX_SETTING_LENGTH) throw new Error(`${key} exceeds the settings size limit.`);
  return value;
}

function parseSettingsDocument(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error('jarvis_settings must contain a JSON object.');
  const legacyVoicebox = parsed.apiMode === 'local'
    && parsed.localAIProfile === undefined
    && Boolean(parsed.brainProvider || parsed.chatModel || parsed.claudeApiKey || parsed.voiceboxProfileId)
    ? { ...parsed, apiMode: 'voicebox' }
    : parsed;
  return jarvisSettingsPatchSchema.parse(legacyVoicebox);
}

function splitSettingsDocument(raw: string): { safe: string; secrets: Record<string, string> } {
  const parsed = parseSettingsDocument(raw);
  const safe = { ...parsed };
  delete safe.apiKey;
  delete safe.claudeApiKey;
  const secrets: Record<string, string> = {};
  if (typeof parsed.apiKey === 'string') secrets.apiKey = parsed.apiKey;
  if (typeof parsed.claudeApiKey === 'string') secrets.claudeApiKey = parsed.claudeApiKey;
  return { safe: JSON.stringify(safe), secrets };
}

function extractSafeSettings(record: Readonly<Record<string, unknown>>): SettingsRecord {
  const safe: SettingsRecord = {};
  for (const key of NON_SECRET_SERVER_KEYS) {
    if (record[key] !== undefined) safe[key] = requireString(key, record[key]);
  }
  if (record.jarvis_settings !== undefined) {
    safe.jarvis_settings = splitSettingsDocument(requireString('jarvis_settings', record.jarvis_settings)).safe;
  }
  return safe;
}

function extractSecretOverlay(record: Readonly<Record<string, unknown>>): SettingsRecord {
  const secrets: SettingsRecord = {};
  for (const key of SECRET_SERVER_KEYS) {
    if (typeof record[key] === 'string') secrets[key] = record[key];
  }
  if (typeof record.jarvis_settings === 'string') {
    try {
      const parsed = JSON.parse(record.jarvis_settings) as unknown;
      if (isRecord(parsed)) {
        const documentSecrets: Record<string, string> = {};
        if (typeof parsed.apiKey === 'string') documentSecrets.apiKey = parsed.apiKey;
        if (typeof parsed.claudeApiKey === 'string') documentSecrets.claudeApiKey = parsed.claudeApiKey;
        if (Object.keys(documentSecrets).length > 0) {
          secrets.jarvis_settings = JSON.stringify(documentSecrets);
        }
      }
    } catch {
      // The importer already records malformed legacy data for diagnostics.
    }
  }
  return secrets;
}

function mergeSettingsDocument(safeRaw?: string, secretRaw?: string): string | undefined {
  if (!safeRaw && !secretRaw) return undefined;
  const safe = safeRaw ? JSON.parse(safeRaw) as unknown : {};
  const secrets = secretRaw ? JSON.parse(secretRaw) as unknown : {};
  if (!isRecord(safe) || !isRecord(secrets)) return safeRaw ?? secretRaw;
  return JSON.stringify({ ...safe, ...secrets });
}

export class CoreStore {
  readonly database: JarvisDatabase;
  readonly dataDirectory: string;
  readonly legacySettingsPath: string;

  constructor(dataDirectory: string, appVersion = 'development') {
    this.dataDirectory = path.resolve(dataDirectory);
    mkdirSync(this.dataDirectory, { recursive: true, mode: 0o700 });
    this.legacySettingsPath = path.join(this.dataDirectory, LEGACY_SETTINGS_FILE);
    this.database = new JarvisDatabase(path.join(this.dataDirectory, DATABASE_FILE), appVersion);
    migrateLegacyJson({
      database: this.database,
      sourceId: LEGACY_SOURCE_ID,
      sourcePath: this.legacySettingsPath,
      backupDirectory: path.join(this.dataDirectory, 'migration-backups'),
      quarantineDirectory: path.join(this.dataDirectory, 'migration-quarantine'),
      importRecord: (record) => this.database.settings.setMany(SERVER_SCOPE, extractSafeSettings(record)),
    });
  }

  readServerSettings(): SettingsRecord {
    const stored = this.database.settings.getAll(SERVER_SCOPE);
    const safe = Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    const legacySecrets = extractSecretOverlay(this.readLegacyRecord(false));
    const merged: SettingsRecord = { ...safe, ...legacySecrets };
    const jarvisSettings = mergeSettingsDocument(safe.jarvis_settings, legacySecrets.jarvis_settings);
    if (jarvisSettings) merged.jarvis_settings = jarvisSettings;
    return merged;
  }

  writeServerSettings(patch: Readonly<Record<string, unknown>>): void {
    const unknownKeys = Object.keys(patch).filter((key) => !ALL_SERVER_KEYS.has(key));
    if (unknownKeys.length > 0) throw new Error(`Unsupported settings: ${unknownKeys.join(', ')}.`);

    const safePatch: SettingsRecord = {};
    const secretPatch: SettingsRecord = {};
    for (const [key, value] of Object.entries(patch)) {
      const stringValue = requireString(key, value);
      if (NON_SECRET_SERVER_KEYS.has(key)) safePatch[key] = stringValue;
      if (SECRET_SERVER_KEYS.has(key)) secretPatch[key] = stringValue;
      if (key === 'jarvis_settings') {
        const split = splitSettingsDocument(stringValue);
        safePatch.jarvis_settings = split.safe;
        if (Object.keys(split.secrets).length > 0) {
          secretPatch.jarvis_settings = JSON.stringify(split.secrets);
        }
      }
    }

    this.database.settings.setMany(SERVER_SCOPE, safePatch);
    if (Object.keys(secretPatch).length > 0) this.writeLegacySecretPatch(secretPatch);
  }

  diagnostics(): DatabaseDiagnostics {
    return this.database.diagnostics();
  }

  createExportPaths(): { database: string; json: string } {
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const exportDirectory = path.join(this.dataDirectory, 'exports');
    return {
      database: path.join(exportDirectory, `jarvis-core-${timestamp}.sqlite3`),
      json: path.join(exportDirectory, `jarvis-core-${timestamp}.json`),
    };
  }

  close(): void {
    this.database.close();
  }

  private readLegacyRecord(strict: boolean): Record<string, unknown> {
    if (!existsSync(this.legacySettingsPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.legacySettingsPath, 'utf8')) as unknown;
      if (!isRecord(parsed)) throw new Error('Legacy settings root must be an object.');
      return parsed;
    } catch (error) {
      if (strict) throw new Error('Legacy secret compatibility file is malformed; see storage diagnostics.', { cause: error });
      return {};
    }
  }

  private writeLegacySecretPatch(patch: SettingsRecord): void {
    const existing = this.readLegacyRecord(true);
    const next = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
      if (key !== 'jarvis_settings') {
        next[key] = value;
        continue;
      }
      const existingDocument = typeof existing.jarvis_settings === 'string'
        ? JSON.parse(existing.jarvis_settings) as unknown
        : {};
      const secretDocument = JSON.parse(value) as unknown;
      if (!isRecord(existingDocument) || !isRecord(secretDocument)) {
        throw new Error('Legacy Jarvis settings secret document is malformed.');
      }
      next.jarvis_settings = JSON.stringify({ ...existingDocument, ...secretDocument });
    }

    const temporary = `${this.legacySettingsPath}.partial`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.legacySettingsPath);
    chmodSync(this.legacySettingsPath, 0o600);
  }
}

declare global {
  var __jarvisCoreStore: CoreStore | undefined;
}

export function getCoreStore(): CoreStore {
  if (!globalThis.__jarvisCoreStore) {
    const dataDirectory = process.env.JARVIS_DATA_DIR || process.cwd();
    const appVersion = process.env.JARVIS_APP_VERSION || process.env.npm_package_version || 'development';
    globalThis.__jarvisCoreStore = new CoreStore(dataDirectory, appVersion);
  }
  return globalThis.__jarvisCoreStore;
}
