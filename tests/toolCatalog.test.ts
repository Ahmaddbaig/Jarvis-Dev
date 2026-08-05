import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capabilityDefinitionSchema } from '../packages/contracts/src';
import {
  createStaticToolCatalog,
  parseStaticToolInput,
  STATIC_TOOL_DECLARATIONS,
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

function structuralJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuralJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['type', 'enum', 'properties', 'required', 'items']) {
    if (key in source) result[key] = structuralJsonSchema(source[key]);
  }
  if (source.properties && typeof source.properties === 'object') {
    result.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>)
        .map(([name, schema]) => [name, structuralJsonSchema(schema)]),
    );
  }
  if (source.type === 'object' && !('required' in result)) result.required = [];
  return result;
}

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

  it('keeps runtime input schemas structurally aligned with existing model schemas', () => {
    for (const fn of FUNCTION_REGISTRY) {
      const declaration = STATIC_TOOL_DECLARATIONS.find(
        (candidate) => candidate.policy.operation === fn.name,
      );
      expect(declaration, fn.name).toBeDefined();
      expect(structuralJsonSchema(z.toJSONSchema(declaration!.inputSchema))).toEqual(
        structuralJsonSchema(fn.tool.parameters),
      );
    }
  });

  it('parses known arguments strictly and rejects unknown operations', () => {
    expect(parseStaticToolInput('computer_use', { task: 'Open settings', screen: 0 })).toEqual({
      task: 'Open settings',
      screen: 0,
    });
    expect(() => parseStaticToolInput('computer_use', { task: 'Open settings', confirmed: true }))
      .toThrow(/Unrecognized key/);
    expect(() => parseStaticToolInput('control_music', { command: 'delete_everything' }))
      .toThrow();
    expect(() => parseStaticToolInput('missing_tool', {})).toThrow(/Unknown static tool operation/);
  });

  it('assigns every operation a unique normalized server handler ID', () => {
    const handlerIds = STATIC_TOOL_DECLARATIONS.map((declaration) => declaration.handlerId);
    expect(new Set(handlerIds).size).toBe(EXPECTED_STATIC_TOOLS.length);
    for (const handlerId of handlerIds) {
      expect(handlerId).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
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
