import {
  commandResultSchema,
  jsonValueSchema,
  type CommandEnvelope,
  type CommandResult,
  type JarvisError,
  type JsonValue,
} from '@jarvis/contracts';
import type { CapabilityPolicyService } from '../policy/service';
import type { Clock, PolicyContext } from '../policy/types';
import type { StaticToolDeclaration } from './declaration';
import {
  resolveStaticToolDeclaration,
  resolveStaticToolHandler,
} from './static-catalog';

const systemClock: Clock = { now: () => Date.now() };

export type StaticToolHandler = (
  input: Record<string, unknown>,
  command: CommandEnvelope,
) => unknown | Promise<unknown>;

export interface StaticToolHandlerRegistration {
  handlerId: string;
  execute: StaticToolHandler;
}

interface DispatchOutcome {
  cacheable: boolean;
  result: CommandResult;
}

interface IdempotencyEntry {
  binding: string;
  result: CommandResult;
}

interface InflightEntry {
  binding: string;
  outcome: Promise<DispatchOutcome>;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function commandBinding(command: CommandEnvelope, context: PolicyContext): string {
  return canonicalJson({
    actor: command.actor,
    context: {
      activeLease: context.activeLease ?? false,
      approvalId: context.approvalId ?? null,
      emergencyStop: context.emergencyStop ?? false,
      enabledAbilities: [...context.enabledAbilities].sort(),
      source: context.source,
      targetPaired: context.targetPaired ?? false,
      untrustedInput: context.untrustedInput ?? false,
      userGesture: context.userGesture ?? false,
      visibleFeedback: context.visibleFeedback ?? false,
    },
    operation: command.operation,
    sessionId: command.sessionId,
    target: command.target,
  });
}

function effectMayOccur(declaration: StaticToolDeclaration): boolean {
  return !['read-public', 'read-private'].includes(declaration.policy.risk);
}

function statusForError(error: JarvisError): string {
  if (error.code === 'EXECUTION.UNKNOWN_SIDE_EFFECT') return 'execution_unknown_side_effect';
  switch (error.family) {
    case 'VALIDATION': return 'validation_error';
    case 'AUTH':
    case 'POLICY': return 'permission_denied';
    case 'NOT_FOUND': return 'not_found';
    case 'CONFLICT': return 'conflict';
    case 'TRANSIENT': return 'unavailable';
    case 'EXECUTION': return 'execution_failed';
    case 'INTERNAL': return 'internal_error';
  }
}

export class StaticToolDispatcher {
  readonly #clock: Clock;
  readonly #completed = new Map<string, IdempotencyEntry>();
  readonly #handlers = new Map<string, StaticToolHandler>();
  readonly #inflight = new Map<string, InflightEntry>();
  readonly #maxCompleted: number;
  readonly #policy: CapabilityPolicyService;

  constructor(options: {
    policy: CapabilityPolicyService;
    handlers: readonly StaticToolHandlerRegistration[];
    clock?: Clock;
    maxCompleted?: number;
  }) {
    this.#policy = options.policy;
    this.#clock = options.clock ?? systemClock;
    this.#maxCompleted = Math.max(1, options.maxCompleted ?? 1_000);
    for (const registration of options.handlers) {
      if (this.#handlers.has(registration.handlerId)) {
        throw new Error(`Static tool handler already registered: ${registration.handlerId}`);
      }
      const known = resolveStaticToolHandler(registration.handlerId);
      if (!known) throw new Error(`Unknown static tool handler: ${registration.handlerId}`);
      this.#handlers.set(registration.handlerId, registration.execute);
    }
  }

  async dispatch(command: CommandEnvelope, context: PolicyContext): Promise<CommandResult> {
    const startedAt = this.#clock.now();
    const declaration = resolveStaticToolDeclaration(command.operation.kind);
    if (!declaration) {
      return this.#failure(command, startedAt, {
        family: 'VALIDATION',
        code: 'VALIDATION.UNKNOWN_OPERATION',
        message: 'The operation is not registered.',
        retryable: false,
        traceId: command.traceId,
      });
    }

    const binding = commandBinding(command, context);
    const completed = this.#completed.get(command.idempotencyKey);
    if (completed) {
      if (completed.binding !== binding) return this.#idempotencyConflict(command, startedAt);
      return this.#correlate(completed.result, command, true);
    }

    const inflight = this.#inflight.get(command.idempotencyKey);
    if (inflight) {
      if (inflight.binding !== binding) return this.#idempotencyConflict(command, startedAt);
      const outcome = await inflight.outcome;
      return this.#correlate(outcome.result, command, true);
    }

    const outcomePromise = this.#execute(command, context, declaration, startedAt);
    this.#inflight.set(command.idempotencyKey, { binding, outcome: outcomePromise });
    try {
      const outcome = await outcomePromise;
      if (outcome.cacheable) this.#remember(command.idempotencyKey, { binding, result: outcome.result });
      return outcome.result;
    } finally {
      if (this.#inflight.get(command.idempotencyKey)?.outcome === outcomePromise) {
        this.#inflight.delete(command.idempotencyKey);
      }
    }
  }

  clearIdempotencyCache(): void {
    this.#completed.clear();
  }

  async #execute(
    command: CommandEnvelope,
    context: PolicyContext,
    declaration: StaticToolDeclaration,
    startedAt: number,
  ): Promise<DispatchOutcome> {
    if (Date.parse(command.deadline) <= this.#clock.now()) {
      return { cacheable: false, result: this.#failure(command, startedAt, {
        family: 'TRANSIENT',
        code: 'TRANSIENT.DEADLINE_EXCEEDED',
        message: 'The command deadline has passed.',
        retryable: true,
        traceId: command.traceId,
      }) };
    }

    const parsedInput = declaration.inputSchema.safeParse(command.operation.args);
    if (!parsedInput.success) {
      return { cacheable: false, result: this.#failure(command, startedAt, {
        family: 'VALIDATION',
        code: 'VALIDATION.INVALID_ARGUMENTS',
        message: 'The operation arguments are invalid.',
        retryable: false,
        traceId: command.traceId,
      }) };
    }

    const handler = this.#handlers.get(declaration.handlerId);
    if (!handler) {
      return { cacheable: false, result: this.#failure(command, startedAt, {
        family: 'INTERNAL',
        code: 'INTERNAL.HANDLER_NOT_REGISTERED',
        message: 'The operation handler is not available.',
        retryable: false,
        traceId: command.traceId,
      }) };
    }

    const decision = this.#policy.evaluate({ command, context });
    if (!decision.allowed) {
      return { cacheable: false, result: this.#failure(command, startedAt, decision.error ?? {
        family: 'POLICY',
        code: 'POLICY.DENIED',
        message: 'The operation is not allowed.',
        retryable: false,
        traceId: command.traceId,
      }) };
    }

    const sideEffect = effectMayOccur(declaration);
    try {
      const rawResult = await handler(parsedInput.data as Record<string, unknown>, command);
      const parsedResult = jsonValueSchema.safeParse(rawResult === undefined ? null : rawResult);
      if (!parsedResult.success) {
        return { cacheable: sideEffect, result: this.#failure(command, startedAt, {
          family: 'INTERNAL',
          code: 'INTERNAL.INVALID_HANDLER_RESULT',
          message: 'The operation returned an invalid result.',
          retryable: false,
          traceId: command.traceId,
        }, {
          attempted: sideEffect,
          completed: sideEffect,
          idempotentReplay: false,
        }) };
      }
      return {
        cacheable: sideEffect,
        result: this.#success(command, startedAt, parsedResult.data, sideEffect),
      };
    } catch {
      const error: JarvisError = sideEffect ? {
        family: 'EXECUTION',
        code: 'EXECUTION.UNKNOWN_SIDE_EFFECT',
        message: 'The operation failed after a side effect may have started.',
        retryable: false,
        traceId: command.traceId,
      } : {
        family: 'EXECUTION',
        code: 'EXECUTION.HANDLER_FAILED',
        message: 'The operation could not be completed.',
        retryable: false,
        traceId: command.traceId,
      };
      return { cacheable: sideEffect, result: this.#failure(command, startedAt, error, {
        attempted: sideEffect,
        completed: false,
        idempotentReplay: false,
      }) };
    }
  }

  #success(
    command: CommandEnvelope,
    startedAt: number,
    result: JsonValue,
    sideEffect: boolean,
  ): CommandResult {
    return this.#result(command, startedAt, {
      ok: true,
      status: 'completed',
      result,
      sideEffect: { attempted: sideEffect, completed: sideEffect, idempotentReplay: false },
    });
  }

  #failure(
    command: CommandEnvelope,
    startedAt: number,
    error: JarvisError,
    sideEffect: CommandResult['sideEffect'] = {
      attempted: false,
      completed: false,
      idempotentReplay: false,
    },
  ): CommandResult {
    return this.#result(command, startedAt, {
      ok: false,
      status: statusForError(error),
      error,
      sideEffect,
    });
  }

  #idempotencyConflict(command: CommandEnvelope, startedAt: number): CommandResult {
    return this.#failure(command, startedAt, {
      family: 'CONFLICT',
      code: 'CONFLICT.IDEMPOTENCY_KEY_REUSED',
      message: 'The idempotency key is already bound to a different command.',
      retryable: false,
      traceId: command.traceId,
    });
  }

  #result(
    command: CommandEnvelope,
    startedAt: number,
    outcome: Pick<CommandResult, 'ok' | 'status' | 'sideEffect'> &
      Partial<Pick<CommandResult, 'result' | 'error'>>,
  ): CommandResult {
    const elapsed = Math.max(0, this.#clock.now() - startedAt);
    return commandResultSchema.parse({
      requestId: command.requestId,
      ...outcome,
      timing: { queuedMs: 0, executionMs: elapsed, totalMs: elapsed },
      traceId: command.traceId,
    });
  }

  #correlate(result: CommandResult, command: CommandEnvelope, replay: boolean): CommandResult {
    return commandResultSchema.parse({
      ...result,
      requestId: command.requestId,
      error: result.error ? { ...result.error, traceId: command.traceId } : undefined,
      sideEffect: { ...result.sideEffect, idempotentReplay: replay },
      timing: { queuedMs: 0, executionMs: 0, totalMs: 0 },
      traceId: command.traceId,
    });
  }

  #remember(key: string, entry: IdempotencyEntry): void {
    while (this.#completed.size >= this.#maxCompleted) {
      const oldest = this.#completed.keys().next().value;
      if (oldest === undefined) break;
      this.#completed.delete(oldest);
    }
    this.#completed.set(key, entry);
  }
}
