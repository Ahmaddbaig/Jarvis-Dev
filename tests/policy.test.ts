import { describe, expect, it } from 'vitest';
import {
  auditEventSchema,
  commandEnvelopeSchema,
  type AuditEvent,
  type CapabilityDefinition,
  type CommandEnvelope,
} from '../packages/contracts/src';
import {
  ApprovalService,
  CapabilityCatalog,
  CapabilityGrantStore,
  CapabilityPolicyService,
  type Clock,
  type PolicyContext,
} from '../packages/core/src';

const definitions: CapabilityDefinition[] = [
  { operation: 'weather.read', capability: 'weather.read', risk: 'read-public', ability: 'weather', confirmation: 'never' },
  { operation: 'calendar.read', capability: 'calendar.read', risk: 'read-private', ability: 'calendar', confirmation: 'never' },
  { operation: 'ui.navigate', capability: 'ui.navigate', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  { operation: 'shell.execute', capability: 'shell.execute', risk: 'local-privileged', ability: 'shell', confirmation: 'when-model' },
  { operation: 'calendar.create', capability: 'calendar.write', risk: 'external-side-effect', ability: 'calendar', confirmation: 'always' },
  { operation: 'companion.click', capability: 'computer.remote', risk: 'remote-control', ability: 'computers', confirmation: 'always', targetFingerprintRequired: true },
  { operation: 'credentials.save', capability: 'credentials.manage', risk: 'credential-operation', ability: 'integrations', confirmation: 'never' },
];

function command(
  operation: string,
  options: {
    actor?: CommandEnvelope['actor'];
    args?: Record<string, string | number | boolean>;
    requestId?: string;
    target?: CommandEnvelope['target'];
  } = {},
): CommandEnvelope {
  return commandEnvelopeSchema.parse({
    protocol: 1,
    requestId: options.requestId ?? 'req:00000000-0000-4000-8000-000000000001',
    idempotencyKey: 'idem:00000000-0000-4000-8000-000000000002',
    actor: options.actor ?? { type: 'desktop-user', id: 'local-user' },
    sessionId: 'session:00000000-0000-4000-8000-000000000003',
    operation: { kind: operation, version: 1, args: options.args ?? {} },
    target: options.target ?? { type: 'integration', id: operation.split('.')[0] },
    deadline: '2030-01-01T00:00:00.000Z',
    traceId: 'trace:00000000-0000-4000-8000-000000000004',
  });
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    source: 'user',
    enabledAbilities: new Set(definitions.map((definition) => definition.ability)),
    ...overrides,
  };
}

const grantGesture = { source: 'user', userGesture: true } as const;

function harness() {
  let now = Date.parse('2026-08-05T12:00:00.000Z');
  const clock: Clock = { now: () => now };
  const audit: AuditEvent[] = [];
  const sink = (event: AuditEvent) => audit.push(auditEventSchema.parse(event));
  const catalog = new CapabilityCatalog(definitions);
  const grants = new CapabilityGrantStore(clock);
  const approvals = new ApprovalService({ clock, audit: sink });
  const policy = new CapabilityPolicyService({ catalog, grants, approvals, audit: sink });
  return { audit, approvals, catalog, grants, policy, setNow: (value: number) => { now = value; } };
}

describe('capability catalog and grants', () => {
  it('rejects invalid and duplicate server-owned definitions', async () => {
    expect(() => new CapabilityCatalog([{ ...definitions[0], capability: 'INVALID' }])).toThrow();
    expect(() => new CapabilityCatalog([definitions[0], definitions[0]])).toThrow(/already exists/);
  });

  it('cannot issue a capability grant from model output or without a user gesture', async () => {
    const { grants } = harness();
    const input = { actorId: 'local-user', capability: 'shell.execute' } as const;
    expect(() => grants.grant(input, { source: 'model', userGesture: true })).toThrow();
    expect(() => grants.grant(input, { source: 'user', userGesture: false })).toThrow();
  });

  it('runtime-validates grant capabilities, target scopes, and expiry', async () => {
    const { grants } = harness();
    expect(() => grants.grant({ actorId: 'local-user', capability: 'INVALID' }, grantGesture)).toThrow();
    expect(() => grants.grant({
      actorId: 'local-user',
      capability: 'shell.execute',
      targetId: 'machine-1',
    }, grantGesture)).toThrow(/targetType/);
    expect(() => grants.grant({
      actorId: 'local-user',
      capability: 'shell.execute',
      expiresAt: 'sometime later',
    }, grantGesture)).toThrow();
  });

  it('allows enabled public reads but denies unknown or disabled operations', async () => {
    const { policy } = harness();
    expect((await policy.evaluate({ command: command('weather.read'), context: context() })).allowed).toBe(true);
    expect((await policy.evaluate({ command: command('weather.read'), context: context({ enabledAbilities: new Set() }) })).error?.code)
      .toBe('POLICY.ABILITY_DISABLED');
    expect((await policy.evaluate({ command: command('unknown.read'), context: context() })).error?.code)
      .toBe('VALIDATION.UNKNOWN_OPERATION');
  });

  it('requires visible feedback for reversible UI actions', async () => {
    const { policy } = harness();
    expect((await policy.evaluate({ command: command('ui.navigate'), context: context() })).error?.code)
      .toBe('POLICY.VISIBLE_FEEDBACK_REQUIRED');
    expect((await policy.evaluate({ command: command('ui.navigate'), context: context({ visibleFeedback: true }) })).allowed).toBe(true);
  });

  it('enforces actor, capability, target, and expiry scopes on grants', async () => {
    const { grants, policy, setNow } = harness();
    const calendar = command('calendar.read');
    grants.grant({
      actorId: calendar.actor.id,
      capability: 'calendar.read',
      targetType: calendar.target.type,
      targetId: 'different-calendar',
    }, grantGesture);
    expect((await policy.evaluate({ command: calendar, context: context() })).error?.code).toBe('POLICY.CAPABILITY_NOT_GRANTED');

    grants.grant({
      actorId: calendar.actor.id,
      capability: 'calendar.read',
      targetType: calendar.target.type,
      targetId: calendar.target.id,
      expiresAt: '2026-08-05T12:00:01.000Z',
    }, grantGesture);
    expect((await policy.evaluate({ command: calendar, context: context() })).allowed).toBe(true);
    setNow(Date.parse('2026-08-05T12:00:02.000Z'));
    expect((await policy.evaluate({ command: calendar, context: context() })).allowed).toBe(false);
  });
});

describe('target-bound approvals', () => {
  it('cannot be issued by a model or without a user gesture', async () => {
    const { approvals, catalog } = harness();
    const shell = command('shell.execute');
    const definition = catalog.resolve(shell.operation.kind)!;
    await expect(approvals.issue(shell, definition, { source: 'model', userGesture: true })).rejects.toThrow();
    await expect(approvals.issue(shell, definition, { source: 'user', userGesture: false })).rejects.toThrow();
  });

  it('allows a model proposal only after a valid one-time approval', async () => {
    const { approvals, catalog, grants, policy } = harness();
    const shell = command('shell.execute', { args: { argv0: 'date' } });
    const definition = catalog.resolve(shell.operation.kind)!;
    grants.grant({ actorId: shell.actor.id, capability: definition.capability }, grantGesture);
    expect((await policy.evaluate({ command: shell, context: context({ source: 'model' }) })).error?.code)
      .toBe('POLICY.CONFIRMATION_REQUIRED');

    const approval = await approvals.issue(shell, definition, { source: 'user', userGesture: true });
    expect((await policy.evaluate({ command: shell, context: context({ source: 'model', approvalId: approval.approvalId }) })).allowed)
      .toBe(true);
    expect((await policy.evaluate({ command: shell, context: context({ source: 'model', approvalId: approval.approvalId }) })).error?.code)
      .toBe('POLICY.APPROVAL_INVALID');
  });

  it('consumes and invalidates approval when arguments or target change', async () => {
    const { approvals, catalog, grants, policy } = harness();
    const original = command('calendar.create', {
      args: { title: 'Synthetic meeting' },
      target: { type: 'calendar', id: 'primary', fingerprint: 'calendar:v1:primary' },
    });
    const definition = catalog.resolve(original.operation.kind)!;
    grants.grant({ actorId: original.actor.id, capability: definition.capability }, grantGesture);
    const receipt = await approvals.issue(original, definition, { source: 'user', userGesture: true });
    const changed = command('calendar.create', {
      args: { title: 'Changed destination' },
      requestId: original.requestId,
      target: { type: 'calendar', id: 'secondary', fingerprint: 'calendar:v1:secondary' },
    });
    expect((await policy.evaluate({ command: changed, context: context({ approvalId: receipt.approvalId }) })).error?.code)
      .toBe('POLICY.APPROVAL_BINDING_MISMATCH');
    expect((await policy.evaluate({ command: original, context: context({ approvalId: receipt.approvalId }) })).error?.code)
      .toBe('POLICY.APPROVAL_INVALID');
  });

  it('rejects expired and fabricated approval IDs', async () => {
    const { approvals, catalog, grants, policy, setNow } = harness();
    const operation = command('calendar.create');
    const definition = catalog.resolve(operation.operation.kind)!;
    grants.grant({ actorId: operation.actor.id, capability: definition.capability }, grantGesture);
    const receipt = await approvals.issue(operation, definition, { source: 'user', userGesture: true, ttlMs: 100 });
    setNow(Date.parse(receipt.expiresAt) + 1);
    expect((await policy.evaluate({ command: operation, context: context({ approvalId: receipt.approvalId }) })).error?.code)
      .toBe('POLICY.APPROVAL_EXPIRED');
    expect((await policy.evaluate({ command: operation, context: context({ approvalId: 'approval:fabricated-0001' }) })).error?.code)
      .toBe('POLICY.APPROVAL_INVALID');
  });

  it('treats untrusted observations like model proposals for confirmation', async () => {
    const { grants, policy } = harness();
    const shell = command('shell.execute');
    grants.grant({ actorId: shell.actor.id, capability: 'shell.execute' }, grantGesture);
    expect((await policy.evaluate({ command: shell, context: context({ source: 'user', untrustedInput: true }) })).error?.code)
      .toBe('POLICY.CONFIRMATION_REQUIRED');
  });
});

describe('privileged policy invariants', () => {
  it('does not let a remote actor obtain desktop-local privilege', async () => {
    const { grants, policy } = harness();
    const remote = command('shell.execute', { actor: { type: 'companion', id: 'remote-device' } });
    grants.grant({ actorId: remote.actor.id, capability: 'shell.execute' }, grantGesture);
    expect((await policy.evaluate({ command: remote, context: context({ source: 'remote-client' }) })).error?.code)
      .toBe('POLICY.DESKTOP_ACTOR_REQUIRED');
  });

  it('never permits model-authorized credential operations', async () => {
    const { grants, policy } = harness();
    const credentials = command('credentials.save');
    grants.grant({ actorId: credentials.actor.id, capability: 'credentials.manage' }, grantGesture);
    expect((await policy.evaluate({ command: credentials, context: context({ source: 'model', userGesture: true }) })).error?.code)
      .toBe('POLICY.USER_GESTURE_REQUIRED');
    expect((await policy.evaluate({ command: credentials, context: context({ source: 'user', userGesture: true }) })).allowed).toBe(true);
  });

  it('requires fingerprint, pairing, lease, emergency-stop clearance, grant, and approval for remote control', async () => {
    const { approvals, catalog, grants, policy } = harness();
    const withoutFingerprint = command('companion.click', { target: { type: 'companion', id: 'device-1' } });
    grants.grant({ actorId: withoutFingerprint.actor.id, capability: 'computer.remote' }, grantGesture);
    expect((await policy.evaluate({ command: withoutFingerprint, context: context() })).error?.code)
      .toBe('VALIDATION.TARGET_FINGERPRINT_REQUIRED');

    const click = command('companion.click', {
      target: { type: 'companion', id: 'device-1', fingerprint: 'sha256:synthetic-device-fingerprint' },
    });
    const definition = catalog.resolve(click.operation.kind)!;
    expect((await policy.evaluate({ command: click, context: context({ targetPaired: false }) })).error?.code)
      .toBe('AUTH.TARGET_NOT_PAIRED');
    expect((await policy.evaluate({ command: click, context: context({ targetPaired: true, activeLease: false }) })).error?.code)
      .toBe('CONFLICT.CONTROL_LEASE_REQUIRED');
    expect((await policy.evaluate({ command: click, context: context({ targetPaired: true, activeLease: true, emergencyStop: true }) })).error?.code)
      .toBe('POLICY.EMERGENCY_STOP_ACTIVE');

    const approval = await approvals.issue(click, definition, { source: 'user', userGesture: true });
    expect((await policy.evaluate({
      command: click,
      context: context({ targetPaired: true, activeLease: true, emergencyStop: false, approvalId: approval.approvalId }),
    })).allowed).toBe(true);
  });

  it('emits schema-valid audit events for decisions and approvals', async () => {
    const { approvals, audit, catalog, policy } = harness();
    const weather = command('weather.read');
    await policy.evaluate({ command: weather, context: context() });
    await approvals.issue(weather, catalog.resolve(weather.operation.kind)!, { source: 'user', userGesture: true });
    expect(audit.length).toBe(2);
    expect(audit.every((event) => auditEventSchema.safeParse(event).success)).toBe(true);
  });
});
