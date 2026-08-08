import { STATIC_TOOL_DEFINITIONS } from '@jarvis/core/tool-catalog';
import type { LegacyJarvisFunction, StaticJarvisFunction } from './types';

export function attachStaticToolPolicies(functions: readonly LegacyJarvisFunction[]): StaticJarvisFunction[] {
  const policies = new Map(STATIC_TOOL_DEFINITIONS.map((definition) => [definition.operation, definition]));
  const names = new Set<string>();
  const result = functions.map((fn) => {
    if (names.has(fn.name)) throw new Error(`Duplicate static tool name: ${fn.name}`);
    names.add(fn.name);
    if (fn.name !== fn.tool.name) throw new Error(`Static tool ${fn.name} has mismatched model name ${fn.tool.name}`);
    const policy = policies.get(fn.name);
    if (!policy) throw new Error(`Static tool ${fn.name} has no server-owned policy definition`);
    return { ...fn, policy };
  });
  const orphanedPolicies = [...policies.keys()].filter((name) => !names.has(name));
  if (orphanedPolicies.length > 0) {
    throw new Error(`Policy definitions have no static tool: ${orphanedPolicies.join(', ')}`);
  }
  return result;
}
