import type { CapabilityDefinition } from '@jarvis/contracts';

export interface ModelFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface JarvisFunction {
  name: string;
  label: string;
  description: string;
  tool: ModelFunctionTool;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  policy?: CapabilityDefinition;
}

export type LegacyJarvisFunction = Omit<JarvisFunction, 'policy'>;
export type StaticJarvisFunction = JarvisFunction & { policy: CapabilityDefinition };
