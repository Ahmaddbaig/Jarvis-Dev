import { z } from 'zod';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const JSON_LIMITS = Object.freeze({
  maxDepth: 8,
  maxArrayItems: 100,
  maxObjectKeys: 100,
  maxKeyLength: 128,
  maxStringLength: 65_536,
  maxNodes: 2_000,
});

interface PendingValue {
  depth: number;
  path: PropertyKey[];
  value: unknown;
}

function inspectJson(value: unknown, context: z.core.$RefinementCtx): void {
  const pending: PendingValue[] = [{ value, depth: 0, path: [] }];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > JSON_LIMITS.maxNodes) {
      context.addIssue({ code: 'custom', message: `JSON exceeds ${JSON_LIMITS.maxNodes} values`, path: current.path });
      return;
    }
    if (current.depth > JSON_LIMITS.maxDepth) {
      context.addIssue({ code: 'custom', message: `JSON nesting exceeds ${JSON_LIMITS.maxDepth}`, path: current.path });
      continue;
    }

    const item = current.value;
    if (item === null || typeof item === 'boolean') continue;
    if (typeof item === 'string') {
      if (item.length > JSON_LIMITS.maxStringLength) {
        context.addIssue({ code: 'custom', message: `String exceeds ${JSON_LIMITS.maxStringLength} characters`, path: current.path });
      }
      continue;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) context.addIssue({ code: 'custom', message: 'JSON numbers must be finite', path: current.path });
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length > JSON_LIMITS.maxArrayItems) {
        context.addIssue({ code: 'custom', message: `Array exceeds ${JSON_LIMITS.maxArrayItems} items`, path: current.path });
        continue;
      }
      for (let index = item.length - 1; index >= 0; index -= 1) {
        pending.push({ value: item[index], depth: current.depth + 1, path: [...current.path, index] });
      }
      continue;
    }
    if (typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype) {
      context.addIssue({ code: 'custom', message: 'Value is not JSON-compatible', path: current.path });
      continue;
    }

    const entries = Object.entries(item);
    if (entries.length > JSON_LIMITS.maxObjectKeys) {
      context.addIssue({ code: 'custom', message: `Object exceeds ${JSON_LIMITS.maxObjectKeys} keys`, path: current.path });
      continue;
    }
    for (const [key, child] of entries) {
      if (key.length > JSON_LIMITS.maxKeyLength) {
        context.addIssue({ code: 'custom', message: `Key exceeds ${JSON_LIMITS.maxKeyLength} characters`, path: [...current.path, key] });
      }
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        context.addIssue({ code: 'custom', message: 'Prototype-related keys are forbidden', path: [...current.path, key] });
        continue;
      }
      pending.push({ value: child, depth: current.depth + 1, path: [...current.path, key] });
    }
  }
}

export const jsonValueSchema = z.unknown().superRefine(inspectJson) as z.ZodType<JsonValue>;
export const jsonObjectSchema = z.record(z.string(), z.unknown()).superRefine(inspectJson) as z.ZodType<Record<string, JsonValue>>;
