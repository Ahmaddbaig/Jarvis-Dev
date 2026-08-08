import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jarvisSettingsPatchSchema } from '../packages/contracts/src';

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('secret ownership boundaries', () => {
  it('rejects credentials embedded in the settings contract', () => {
    expect(jarvisSettingsPatchSchema.safeParse({ apiKey: 'synthetic-secret' }).success).toBe(false);
    expect(jarvisSettingsPatchSchema.safeParse({ claudeApiKey: 'synthetic-secret' }).success).toBe(false);
  });

  it('does not persist legacy renderer credentials or send integration secrets in URLs', () => {
    const renderer = [
      source('frontend/lib/functions.ts'),
      source('frontend/lib/serverSettings.ts'),
      source('frontend/hooks/queries/useHomeAssistant.ts'),
    ].join('\n');
    expect(renderer).not.toMatch(/localStorage\.setItem\(['"]jarvis_(?:ha_token|ical_url)/);
    expect(renderer).not.toMatch(/home-assistant\?[^'"`]*(?:token|url)=/);
    expect(renderer).not.toMatch(/ical\?url=/);
    expect(renderer).not.toMatch(/body:\s*JSON\.stringify\([^)]*apiKey/);
  });

  it('keeps provider keys out of subprocess arguments and API response objects', () => {
    const computerUse = source('app/api/computer-use/route.ts');
    expect(computerUse).not.toMatch(/args\s*=\s*\[[^\]]*apiKey/);
    expect(computerUse).not.toMatch(/args:\s*\[[^\]]*apiKey/);
    expect(computerUse).toContain('proc.stdin.end(apiKey)');

    const bambuLogin = source('app/api/bambu/login/route.ts');
    const bambuVerify = source('app/api/bambu/verify/route.ts');
    expect(bambuLogin).not.toMatch(/token:\s*authData/);
    expect(bambuVerify).not.toMatch(/raw:\s*data/);
  });

  it('returns only credential configuration state to settings consumers', () => {
    const settingsRoute = source('app/api/settings/route.ts');
    expect(settingsRoute).toContain('credentialStatus: getCredentialService().status()');
    expect(settingsRoute).not.toContain("getCredentialService().get(");
  });
});
