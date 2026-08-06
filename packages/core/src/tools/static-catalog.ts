import type { CapabilityDefinition } from '@jarvis/contracts';
import { CapabilityCatalog } from '../policy/catalog';
import type { StaticToolDeclaration } from './declaration';
import { BROWSER_TOOLS } from './domains/browser';
import { COMPUTER_TOOLS } from './domains/computer';
import { INFORMATION_TOOLS } from './domains/information';
import { MEDIA_TOOLS } from './domains/media';
import { PRESENTATION_TOOLS } from './domains/presentation';
import { SMART_ENVIRONMENT_TOOLS } from './domains/smart-environment';
import { SYSTEM_TOOLS } from './domains/system';

const domainDeclarations: StaticToolDeclaration[] = [
  ...INFORMATION_TOOLS,
  ...COMPUTER_TOOLS,
  ...MEDIA_TOOLS,
  ...SMART_ENVIRONMENT_TOOLS,
  ...SYSTEM_TOOLS,
  ...BROWSER_TOOLS,
  ...PRESENTATION_TOOLS,
];

const declarationsByOperation = new Map<string, StaticToolDeclaration>();
const declarationsByHandler = new Map<string, StaticToolDeclaration>();
for (const declaration of domainDeclarations) {
  const operation = declaration.policy.operation;
  if (declarationsByOperation.has(operation)) throw new Error(`Duplicate static tool operation: ${operation}`);
  if (declarationsByHandler.has(declaration.handlerId)) throw new Error(`Duplicate static tool handler: ${declaration.handlerId}`);
  declarationsByOperation.set(operation, declaration);
  declarationsByHandler.set(declaration.handlerId, declaration);
}

const COMPATIBILITY_ORDER = [
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

const declarations = COMPATIBILITY_ORDER.map((operation) => {
  const declaration = declarationsByOperation.get(operation);
  if (!declaration) throw new Error(`Static tool compatibility order references unknown operation: ${operation}`);
  return declaration;
});
if (declarations.length !== domainDeclarations.length) {
  const unordered = domainDeclarations
    .map((declaration) => declaration.policy.operation)
    .filter((operation) => !COMPATIBILITY_ORDER.includes(operation as typeof COMPATIBILITY_ORDER[number]));
  throw new Error(`Static tools missing from compatibility order: ${unordered.join(', ')}`);
}

export const STATIC_TOOL_DECLARATIONS: readonly StaticToolDeclaration[] = Object.freeze(declarations);
export const STATIC_TOOL_DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze(
  declarations.map((declaration) => declaration.policy),
);

export function resolveStaticToolDeclaration(operation: string): StaticToolDeclaration | undefined {
  return declarationsByOperation.get(operation);
}

export function resolveStaticToolHandler(handlerId: string): StaticToolDeclaration | undefined {
  return declarationsByHandler.get(handlerId);
}

export function parseStaticToolInput(operation: string, input: unknown): unknown {
  const declaration = resolveStaticToolDeclaration(operation);
  if (!declaration) throw new Error(`Unknown static tool operation: ${operation}`);
  return declaration.inputSchema.parse(input);
}

export function createStaticToolCatalog(): CapabilityCatalog {
  return new CapabilityCatalog(STATIC_TOOL_DEFINITIONS);
}

/**
 * Translate the user's per-operation toggles into the ability set policy gates
 * on.
 *
 * Settings track 31 operations; policy gates 21 coarser abilities, and several
 * operations share one (six are `interface`). An ability is enabled when any
 * operation under it is enabled — the finer per-operation choice is still
 * enforced, because the caller resolves the tool against the enabled set
 * before dispatching. Deriving the mapping here keeps the two vocabularies
 * from being reconciled ad hoc at each call site.
 */
export function abilitiesForOperations(enabledOperations: Iterable<string>): Set<string> {
  const abilities = new Set<string>();
  for (const operation of enabledOperations) {
    const declaration = declarationsByOperation.get(operation);
    if (declaration) abilities.add(declaration.policy.ability);
  }
  return abilities;
}

/**
 * Operations the user has enabled that carry a given ability. Used to explain
 * a denial back to the user in terms of the toggle they actually control.
 */
export function operationsForAbility(ability: string): readonly string[] {
  return declarations
    .filter((declaration) => declaration.policy.ability === ability)
    .map((declaration) => declaration.policy.operation);
}
