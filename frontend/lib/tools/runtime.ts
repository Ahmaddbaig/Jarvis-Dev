import {
  JARVIS_PROTOCOL_VERSION,
  type CommandEnvelope,
  type CommandResult,
} from '@jarvis/contracts';
import { StaticToolDispatcher } from '@jarvis/core/dispatcher';
import {
  ApprovalService,
  CapabilityGrantStore,
  CapabilityPolicyService,
  confirmationRequiredFor,
  type PolicyContext,
  type RequestSource,
} from '@jarvis/core/policy';
import {
  abilitiesForOperations,
  createStaticToolCatalog,
  resolveStaticToolDeclaration,
} from '@jarvis/core/tool-catalog';
import type { JarvisFunction } from '@/frontend/lib/functions';

/**
 * Policy-enforced execution for the static tool catalog.
 *
 * Handlers live in the renderer because most of them drive it — navigation,
 * HUD, playback, window mode — so the enforcement point is here too. The
 * principal being constrained is the model, not the renderer: a tool call
 * arrives as text the model produced, possibly shaped by content it read
 * (search results, page contents), and this layer decides whether it runs.
 */

export type ToolConfirmationRequest = {
  operation: string;
  label: string;
  risk: string;
  args: Record<string, unknown>;
};

export type ToolConfirmationHandler = (request: ToolConfirmationRequest) => Promise<boolean>;

export interface ToolRuntimeOptions {
  /** Stable identifier for the desktop user this renderer belongs to. */
  actorId: string;
  /** True when running inside the Electron shell rather than a LAN browser. */
  isDesktop: boolean;
  sessionId: string;
  /** Raises the confirmation UI; resolves true when the user approves. */
  confirm: ToolConfirmationHandler;
  audit?: (event: unknown) => void;
}

export interface ToolInvocation {
  name: string;
  args: Record<string, unknown>;
  source: RequestSource;
  /** Set when the arguments came from content the model read rather than the user. */
  untrustedInput?: boolean;
}

const SESSION_ID_FALLBACK = 'session:renderer';

function isoDeadline(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export class ToolRuntime {
  readonly #approvals: ApprovalService;
  readonly #confirm: ToolConfirmationHandler;
  readonly #dispatcher: StaticToolDispatcher;
  readonly #functions = new Map<string, JarvisFunction>();
  readonly #grants: CapabilityGrantStore;
  readonly #options: ToolRuntimeOptions;
  readonly #policy: CapabilityPolicyService;
  #enabledOperations: ReadonlySet<string> = new Set();

  constructor(functions: readonly JarvisFunction[], options: ToolRuntimeOptions) {
    this.#options = options;
    this.#confirm = options.confirm;
    this.#grants = new CapabilityGrantStore();
    this.#approvals = new ApprovalService({ audit: options.audit as never });
    this.#policy = new CapabilityPolicyService({
      catalog: createStaticToolCatalog(),
      grants: this.#grants,
      approvals: this.#approvals,
      audit: options.audit as never,
    });

    const handlers = [];
    for (const fn of functions) {
      const declaration = resolveStaticToolDeclaration(fn.name);
      if (!declaration) continue; // MCP and skill tools are not in the static catalog.
      this.#functions.set(fn.name, fn);
      handlers.push({
        handlerId: declaration.handlerId,
        execute: async (input: Record<string, unknown>) => {
          const result = await fn.handler(input);
          return result === undefined ? null : result;
        },
      });
    }
    this.#dispatcher = new StaticToolDispatcher({ policy: this.#policy, handlers });
  }

  /**
   * Re-issue capability grants from the user's enabled-tool settings.
   *
   * Toggling a tool in Settings is the explicit desktop-user gesture that
   * authorizes it; policy models that as a scoped grant. Grants are rebuilt
   * wholesale so disabling a tool revokes it immediately.
   */
  syncEnabledOperations(enabledOperations: Iterable<string>): void {
    const enabled = new Set(enabledOperations);
    this.#enabledOperations = enabled;
    this.#grants.revokeAll();
    if (!this.#options.isDesktop) return;
    for (const operation of enabled) {
      const declaration = resolveStaticToolDeclaration(operation);
      if (!declaration) continue;
      this.#grants.grant(
        { actorId: this.#options.actorId, capability: declaration.policy.capability },
        { source: 'user', userGesture: true },
      );
    }
  }

  /** Tools the model may be told about: enabled, and present in the catalog. */
  advertisedFunctions(all: readonly JarvisFunction[]): JarvisFunction[] {
    return all.filter((fn) => this.#enabledOperations.has(fn.name));
  }

  async invoke(invocation: ToolInvocation): Promise<CommandResult | null> {
    const declaration = resolveStaticToolDeclaration(invocation.name);
    if (!declaration) return null; // Not a static tool; the caller falls back.

    const command = this.#envelope(invocation);
    const baseContext = this.#context(invocation);

    // Ask for confirmation before dispatching, not after a denial: evaluating
    // twice would double-count the audit trail and burn the approval.
    let approvalId: string | undefined;
    if (confirmationRequiredFor(declaration.policy, baseContext)) {
      const approved = await this.#confirm({
        operation: invocation.name,
        label: this.#functions.get(invocation.name)?.label ?? invocation.name,
        risk: declaration.policy.risk,
        args: invocation.args,
      });
      if (!approved) {
        return {
          requestId: command.requestId,
          ok: false,
          status: 'permission_denied',
          error: {
            family: 'POLICY',
            code: 'POLICY.USER_DECLINED',
            message: `${invocation.name} was declined.`,
            retryable: false,
            traceId: command.traceId,
          },
          sideEffect: { attempted: false, completed: false, idempotentReplay: false },
          timing: { queuedMs: 0, executionMs: 0, totalMs: 0 },
          traceId: command.traceId,
        };
      }
      const receipt = await this.#approvals.issue(command, declaration.policy, {
        source: 'user',
        userGesture: true,
      });
      approvalId = receipt.approvalId;
    }

    return this.#dispatcher.dispatch(command, { ...baseContext, approvalId });
  }

  #context(invocation: ToolInvocation): PolicyContext {
    return {
      source: invocation.source,
      enabledAbilities: abilitiesForOperations(this.#enabledOperations),
      // The renderer is the user's foreground window: anything it does is on
      // screen, which is what local-reversible operations require.
      visibleFeedback: true,
      userGesture: invocation.source === 'user',
      untrustedInput: invocation.untrustedInput ?? false,
    };
  }

  #envelope(invocation: ToolInvocation): CommandEnvelope {
    const requestId = `req:${crypto.randomUUID()}`;
    // Model-supplied arguments arrive as parsed JSON; the declaration's schema
    // is what actually validates them, inside the dispatcher.
    const args = invocation.args as CommandEnvelope['operation']['args'];
    return {
      protocol: JARVIS_PROTOCOL_VERSION,
      requestId,
      idempotencyKey: `idem:${crypto.randomUUID()}`,
      actor: {
        type: this.#options.isDesktop ? 'desktop-user' : 'lan-client',
        id: this.#options.actorId,
      },
      sessionId: this.#options.sessionId || SESSION_ID_FALLBACK,
      operation: { kind: invocation.name, version: 1, args },
      target: { type: 'renderer', id: 'jarvis-desktop' },
      deadline: isoDeadline(60_000),
      traceId: `trace:${crypto.randomUUID()}`,
    };
  }
}
