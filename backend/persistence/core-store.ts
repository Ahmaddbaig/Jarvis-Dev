import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jarvisSettingsPatchSchema, NON_SECRET_SERVER_SETTING_KEYS } from '@jarvis/contracts';
import { JarvisDatabase, migrateLegacyJson, type DatabaseDiagnostics } from '@jarvis/persistence';

const SERVER_SCOPE = 'server';
const LEGACY_SETTINGS_FILE = 'jarvis-server-settings.json';
const DATABASE_FILE = 'jarvis-core.sqlite3';
const LEGACY_SOURCE_ID = 'jarvis-server-settings-v1';
const MAX_SETTING_LENGTH = 1_048_576;

const NON_SECRET_SERVER_KEYS = new Set<string>(NON_SECRET_SERVER_SETTING_KEYS);

const ALL_SERVER_KEYS = new Set([
  'jarvis_settings',
  ...NON_SECRET_SERVER_KEYS,
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

function parseSettingsDocument(raw: string): { safe: Record<string, unknown>; containsSecrets: boolean } {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error('jarvis_settings must contain a JSON object.');
  const containsSecrets = (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0)
    || (typeof parsed.claudeApiKey === 'string' && parsed.claudeApiKey.length > 0);
  const legacyVoicebox = parsed.apiMode === 'local'
    && parsed.localAIProfile === undefined
    && Boolean(parsed.brainProvider || parsed.chatModel || parsed.claudeApiKey || parsed.voiceboxProfileId)
    ? { ...parsed, apiMode: 'voicebox' }
    : parsed;
  const withoutSecrets = { ...legacyVoicebox };
  delete withoutSecrets.apiKey;
  delete withoutSecrets.claudeApiKey;
  return { safe: jarvisSettingsPatchSchema.parse(withoutSecrets), containsSecrets };
}

function splitSettingsDocument(raw: string): { safe: string; containsSecrets: boolean } {
  const parsed = parseSettingsDocument(raw);
  return { safe: JSON.stringify(parsed.safe), containsSecrets: parsed.containsSecrets };
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
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }

  writeServerSettings(patch: Readonly<Record<string, unknown>>): void {
    const unknownKeys = Object.keys(patch).filter((key) => !ALL_SERVER_KEYS.has(key));
    if (unknownKeys.length > 0) throw new Error(`Unsupported settings: ${unknownKeys.join(', ')}.`);

    const safePatch: SettingsRecord = {};
    for (const [key, value] of Object.entries(patch)) {
      const stringValue = requireString(key, value);
      if (NON_SECRET_SERVER_KEYS.has(key)) safePatch[key] = stringValue;
      if (key === 'jarvis_settings') {
        const split = splitSettingsDocument(stringValue);
        if (split.containsSecrets) {
          throw new Error('Credentials must be saved through the desktop credential service.');
        }
        safePatch.jarvis_settings = split.safe;
      }
    }

    this.database.settings.setMany(SERVER_SCOPE, safePatch);
  }

  removeLegacyCredentialValues(): void {
    if (!existsSync(this.legacySettingsPath)) return;
    const existing = this.readLegacyRecord(true);
    const sanitized = { ...existing };
    delete sanitized.jarvis_ha_token;
    delete sanitized.jarvis_ical_url;
    if (typeof sanitized.jarvis_settings === 'string') {
      const parsed = JSON.parse(sanitized.jarvis_settings) as unknown;
      if (!isRecord(parsed)) throw new Error('Legacy Jarvis settings document is malformed.');
      const safe = { ...parsed };
      delete safe.apiKey;
      delete safe.claudeApiKey;
      sanitized.jarvis_settings = JSON.stringify(safe);
    }
    this.writeLegacyRecord(sanitized);
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

  private writeLegacyRecord(record: Readonly<Record<string, unknown>>): void {
    const temporary = `${this.legacySettingsPath}.partial`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
