import {
  capabilityDefinitionSchema,
  operationIdSchema,
  type CapabilityDefinition,
} from '@jarvis/contracts';
import type { z } from 'zod';

export interface StaticToolDeclaration {
  readonly handlerId: string;
  readonly inputSchema: z.ZodType;
  readonly policy: CapabilityDefinition;
}

export function defineStaticTool(declaration: StaticToolDeclaration): StaticToolDeclaration {
  const handlerId = operationIdSchema.parse(declaration.handlerId);
  const policy = Object.freeze(capabilityDefinitionSchema.parse(declaration.policy));
  return Object.freeze({ handlerId, inputSchema: declaration.inputSchema, policy });
}
