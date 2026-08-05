import { describe, expect, it } from 'vitest';
import {
  commandEnvelopeSchema,
  commandResultSchema,
  type CommandEnvelope,
} from '../packages/contracts/src';
import {
  ApprovalService,
  CapabilityGrantStore,
  CapabilityPolicyService,
  type Clock,
  type PolicyContext,
} from '../packages/core/src';
import { StaticToolDispatcher } from '../packages/core/src/tools/dispatcher';
import {
  createStaticToolCatalog,
  STATIC_TOOL_DEFINITIONS,
} from '../packages/core/src/tools/static-catalog';

let sequence = 100;

function nextId(prefix: 'req' | 'idem' | 'trace'): string {
  sequence += 1;
  return `${prefix}:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function command(
  operation: string,
  args: Record<string, string | number | boolean | string[]> = {},
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope {
  return commandEnvelopeSchema.parse({
    protocol: 1,
    requestId: nextId('req'),
    idempotencyKey: nextId('idem'),
    actor: { type: 'desktop-user', id: 'local-user' },
    sessionId: 'session:00000000-0000-4000-8000-000000000200',
    operation: { kind: operation, version: 1, args },
    target: { type: 'integration', id: operation },
    deadline: '2030-01-01T00:00:00.000Z',
    traceId: nextId('trace'),
    ...overrides,
  });
}

function harness(handlers: ConstructorParameters<typeof StaticToolDispatcher>[0]['handlers']) {
  let now = Date.parse('2026-08-05T12:00:00.000Z');
  const clock: Clock = { now: () => now };
  const catalog = createStaticToolCatalog();
  const grants = new CapabilityGrantStore(clock);
  const approvals = new ApprovalService({ clock });
  const policy = new CapabilityPolicyService({ catalog, grants, approvals });
  const dispatcher = new StaticToolDispatcher({ policy, handlers, clock });
  const context: PolicyContext = {
    source: 'user',
    enabledAbilities: new Set(STATIC_TOOL_DEFINITIONS.map((definition) => definition.ability)),
    visibleFeedback: true,
  };
  return {
    approvals,
    catalog,
    context,
    dispatcher,
    grants,
    setNow(value: number) { now = value; },
  };
}

const userGesture = { source: 'user', userGesture: true } as const;

describe('static tool dispatcher', () => {
  it('returns the stable result contract for a validated public-read handler', async () => {
    const { context, dispatcher } = harness([{
      handlerId: 'information.web_search',
      execute: (input) => ({ query: input.query, results: [] }),
    }]);
    const result = await dispatcher.dispatch(command('web_search', { query: 'synthetic query' }), context);

    expect(commandResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      result: { query: 'synthetic query', results: [] },
      sideEffect: { attempted: false, completed: false, idempotentReplay: false },
    });
  });

  it('rejects invalid arguments, missing handlers, and policy denials before execution', async () => {
    let executions = 0;
    const { context, dispatcher } = harness([
      { handlerId: 'information.web_search', execute: () => { executions += 1; return {}; } },
      { handlerId: 'information.get_location', execute: () => { executions += 1; return {}; } },
    ]);

    const invalid = await dispatcher.dispatch(command('web_search'), context);
    expect(invalid.error?.code).toBe('VALIDATION.INVALID_ARGUMENTS');

    const missing = await dispatcher.dispatch(command('get_date'), context);
    expect(missing.error?.code).toBe('INTERNAL.HANDLER_NOT_REGISTERED');

    const denied = await dispatcher.dispatch(command('get_location'), context);
    expect(denied.error?.code).toBe('POLICY.CAPABILITY_NOT_GRANTED');
    expect(executions).toBe(0);
  });

  it('rejects unknown and duplicate handler registrations', () => {
    const { policy } = (() => {
      const clock: Clock = { now: () => Date.parse('2026-08-05T12:00:00.000Z') };
      const catalog = createStaticToolCatalog();
      return {
        policy: new CapabilityPolicyService({
          catalog,
          grants: new CapabilityGrantStore(clock),
          approvals: new ApprovalService({ clock }),
        }),
      };
    })();

    expect(() => new StaticToolDispatcher({
      policy,
      handlers: [{ handlerId: 'unknown.handler', execute: () => null }],
    })).toThrow(/Unknown static tool handler/);
    expect(() => new StaticToolDispatcher({
      policy,
      handlers: [
        { handlerId: 'information.get_date', execute: () => null },
        { handlerId: 'information.get_date', execute: () => null },
      ],
    })).toThrow(/already registered/);
  });

  it('coalesces concurrent commands and marks later delivery as an idempotent replay', async () => {
    let executions = 0;
    let release: ((value: unknown) => void) | undefined;
    const pending = new Promise((resolve) => { release = resolve; });
    const { context, dispatcher } = harness([{
      handlerId: 'information.web_search',
      execute: async () => {
        executions += 1;
        return pending;
      },
    }]);
    const request = command('web_search', { query: 'one execution' });
    const first = dispatcher.dispatch(request, context);
    const second = dispatcher.dispatch(request, context);
    release?.({ results: ['synthetic'] });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(executions).toBe(1);
    expect(firstResult.sideEffect.idempotentReplay).toBe(false);
    expect(secondResult.sideEffect.idempotentReplay).toBe(true);
    expect(secondResult.result).toEqual(firstResult.result);
  });

  it('rejects reuse of an idempotency key for different arguments', async () => {
    let executions = 0;
    const { context, dispatcher } = harness([{
      handlerId: 'presentation.show_hud_text',
      execute: () => { executions += 1; return { results: [] }; },
    }]);
    const original = command('show_hud_text', { content: 'first' });
    expect((await dispatcher.dispatch(original, context)).ok).toBe(true);
    const changed = command('show_hud_text', { content: 'changed' }, {
      idempotencyKey: original.idempotencyKey,
    });
    const conflict = await dispatcher.dispatch(changed, context);

    expect(conflict.error?.code).toBe('CONFLICT.IDEMPOTENCY_KEY_REUSED');
    expect(executions).toBe(1);
  });

  it('binds effectful replays to the original policy context', async () => {
    let executions = 0;
    const { context, dispatcher } = harness([{
      handlerId: 'presentation.show_hud_text',
      execute: () => { executions += 1; return { shown: true }; },
    }]);
    const request = command('show_hud_text', { content: 'policy binding' });
    expect((await dispatcher.dispatch(request, context)).ok).toBe(true);
    const changedContext = { ...context, source: 'model' } as const;
    const conflict = await dispatcher.dispatch(request, changedContext);

    expect(conflict.error?.code).toBe('CONFLICT.IDEMPOTENCY_KEY_REUSED');
    expect(executions).toBe(1);
  });

  it('does not retry an effectful handler after an unknown-side-effect failure', async () => {
    let executions = 0;
    const runtime = harness([{
      handlerId: 'system.run_shell_command',
      execute: () => { executions += 1; throw new Error('synthetic secret-bearing failure'); },
    }]);
    const request = command('run_shell_command', { command: 'synthetic-command' });
    const definition = runtime.catalog.resolve(request.operation.kind)!;
    runtime.grants.grant({ actorId: request.actor.id, capability: definition.capability }, userGesture);
    const approval = runtime.approvals.issue(request, definition, userGesture);
    const context = { ...runtime.context, source: 'model', approvalId: approval.approvalId } as const;

    const failed = await runtime.dispatcher.dispatch(request, context);
    const replay = await runtime.dispatcher.dispatch(request, context);
    expect(failed).toMatchObject({
      ok: false,
      status: 'execution_unknown_side_effect',
      error: { code: 'EXECUTION.UNKNOWN_SIDE_EFFECT' },
      sideEffect: { attempted: true, completed: false, idempotentReplay: false },
    });
    expect(failed.error?.message).not.toContain('secret-bearing');
    expect(replay.sideEffect.idempotentReplay).toBe(true);
    expect(executions).toBe(1);
  });

  it('rejects expired commands without executing the handler', async () => {
    let executions = 0;
    const runtime = harness([{
      handlerId: 'information.get_date',
      execute: () => { executions += 1; return {}; },
    }]);
    runtime.setNow(Date.parse('2030-01-01T00:00:00.000Z'));
    const result = await runtime.dispatcher.dispatch(command('get_date'), runtime.context);
    expect(result.error?.code).toBe('TRANSIENT.DEADLINE_EXCEEDED');
    expect(result.error?.retryable).toBe(true);
    expect(executions).toBe(0);
  });
});
