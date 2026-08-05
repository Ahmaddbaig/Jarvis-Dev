import { capabilityDefinitionSchema, type CapabilityDefinition } from '@jarvis/contracts';

export class CapabilityCatalog {
  readonly #definitions = new Map<string, CapabilityDefinition>();

  constructor(definitions: readonly CapabilityDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: CapabilityDefinition): void {
    const parsed = capabilityDefinitionSchema.parse(definition);
    if (this.#definitions.has(parsed.operation)) {
      throw new Error(`Capability definition already exists for ${parsed.operation}`);
    }
    this.#definitions.set(parsed.operation, Object.freeze(parsed));
  }

  resolve(operation: string): CapabilityDefinition | undefined {
    return this.#definitions.get(operation);
  }

  list(): readonly CapabilityDefinition[] {
    return [...this.#definitions.values()];
  }
}
