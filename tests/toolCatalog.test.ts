import { describe, expect, it } from 'vitest';
import { capabilityDefinitionSchema } from '../packages/contracts/src';
import {
  createStaticToolCatalog,
  STATIC_TOOL_DEFINITIONS,
} from '../packages/core/src/tools/static-catalog';
import { FUNCTION_REGISTRY, getFunctionByName } from '../frontend/lib/functions';
import { attachStaticToolPolicies } from '../frontend/lib/tools/compatibility';

const EXPECTED_STATIC_TOOLS = [
  'get_date',
  'get_time',
  'get_location',
  'get_battery_level',
  'computer_use',
  'companion_control',
  'deskflow_control',
  'xray',
  'image_generation',
  '3d_printing',
  'run_shell_command',
  'web_search',
  'chrome_control',
  'take_photo',
  'play_spotify',
  'control_music',
  'get_now_playing',
  'show_hud_text',
  'control_hud',
  'open_url',
  'open_pdf',
  'find_datasheet',
  'desktop_mode',
  'jarvis_disconnect',
  'navigate_to_page',
  'map_command',
  'calendar_command',
  'home_assistant_command',
  'printer_command',
  'add_home_widget',
  'fullscreen',
] as const;

describe('static tool catalog', () => {
  it('covers the legacy registry exactly once with runtime-valid server metadata', () => {
    expect(FUNCTION_REGISTRY.map((fn) => fn.name)).toEqual(EXPECTED_STATIC_TOOLS);
    expect(STATIC_TOOL_DEFINITIONS.map((definition) => definition.operation)).toEqual(EXPECTED_STATIC_TOOLS);
    expect(new Set(FUNCTION_REGISTRY.map((fn) => fn.name)).size).toBe(EXPECTED_STATIC_TOOLS.length);

    for (const fn of FUNCTION_REGISTRY) {
      expect(fn.tool.name).toBe(fn.name);
      expect(fn.policy).toEqual(capabilityDefinitionSchema.parse(fn.policy));
      expect(fn.policy?.operation).toBe(fn.name);
      expect(Object.isFrozen(fn.policy)).toBe(true);
    }
  });

  it('creates a resolvable core-owned capability catalog', () => {
    const catalog = createStaticToolCatalog();
    expect(catalog.list()).toHaveLength(EXPECTED_STATIC_TOOLS.length);
    for (const name of EXPECTED_STATIC_TOOLS) {
      expect(catalog.resolve(name)?.operation).toBe(name);
    }
  });

  it('requires confirmation for privileged and externally effectful static tools', () => {
    const privilegedRisks = new Set([
      'local-privileged',
      'external-side-effect',
      'remote-control',
      'credential-operation',
    ]);
    for (const definition of STATIC_TOOL_DEFINITIONS) {
      if (privilegedRisks.has(definition.risk)) {
        expect(definition.confirmation).not.toBe('never');
      }
    }
  });

  it('keeps existing lookup and harmless information handlers working', async () => {
    await expect(Promise.resolve(getFunctionByName('get_date')?.handler({}))).resolves.toEqual({
      date: expect.any(String),
    });
    expect(getFunctionByName('missing_tool')).toBeUndefined();
  });
});

describe('legacy registry compatibility bridge', () => {
  it('fails closed for duplicate, mismatched, or incomplete legacy definitions', () => {
    expect(() => attachStaticToolPolicies([...FUNCTION_REGISTRY, FUNCTION_REGISTRY[0]])).toThrow(
      /Duplicate static tool name/,
    );
    expect(() => attachStaticToolPolicies([
      ...FUNCTION_REGISTRY.slice(0, 1).map((fn) => ({
        ...fn,
        tool: { ...fn.tool, name: 'different_name' },
      })),
      ...FUNCTION_REGISTRY.slice(1),
    ])).toThrow(/mismatched model name/);
    expect(() => attachStaticToolPolicies(FUNCTION_REGISTRY.slice(1))).toThrow(
      /Policy definitions have no static tool/,
    );
  });
});
