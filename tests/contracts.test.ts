import { describe, expect, it } from 'vitest';
import {
  ERROR_HTTP_STATUS,
  JSON_LIMITS,
  JARVIS_PROTOCOL_VERSION,
  commandEnvelopeSchema,
  commandResultSchema,
  createIdempotencyKey,
  createRequestId,
  createTraceId,
  jarvisErrorSchema,
  jsonValueSchema,
  protocolHandshakeSchema,
} from '../packages/contracts/src';

function validCommand() {
  return {
    protocol: JARVIS_PROTOCOL_VERSION,
    requestId: 'req:00000000-0000-4000-8000-000000000001',
    idempotencyKey: 'idem:00000000-0000-4000-8000-000000000002',
    actor: { type: 'desktop-user', id: 'local-user' },
    sessionId: 'session:00000000-0000-4000-8000-000000000003',
    operation: { kind: 'weather.read', version: 1, args: { location: 'Synthetic City' } },
    target: { type: 'integration', id: 'weather' },
    deadline: '2030-01-01T00:00:00.000Z',
    traceId: 'trace:00000000-0000-4000-8000-000000000004',
  } as const;
}

function validResult() {
  return {
    requestId: validCommand().requestId,
    ok: true,
    status: 'completed',
    result: { temperatureC: 20 },
    sideEffect: { attempted: false, completed: false, idempotentReplay: false },
    timing: { queuedMs: 2, executionMs: 5, totalMs: 7 },
    traceId: validCommand().traceId,
  } as const;
}

describe('command envelope contract', () => {
  it('accepts the versioned standard envelope', () => {
    expect(commandEnvelopeSchema.parse(validCommand())).toEqual(validCommand());
  });

  it('rejects unsupported protocol versions', () => {
    expect(commandEnvelopeSchema.safeParse({ ...validCommand(), protocol: 2 }).success).toBe(false);
  });

  it('rejects unknown high-risk fields', () => {
    const attemptedBypass = { ...validCommand(), confirmed: true };
    expect(commandEnvelopeSchema.safeParse(attemptedBypass).success).toBe(false);
  });

  it('rejects unknown operation fields', () => {
    const operation = { ...validCommand().operation, capability: 'shell.execute' };
    expect(commandEnvelopeSchema.safeParse({ ...validCommand(), operation }).success).toBe(false);
  });

  it('rejects policy-owned fields smuggled through operation arguments', () => {
    for (const forbidden of ['confirmed', 'confirmationId', 'approvalId', 'capability', 'risk']) {
      const operation = { ...validCommand().operation, args: { [forbidden]: true } };
      expect(commandEnvelopeSchema.safeParse({ ...validCommand(), operation }).success).toBe(false);
    }
  });

  it('requires normalized operation names and timestamps', () => {
    expect(commandEnvelopeSchema.safeParse({
      ...validCommand(),
      operation: { ...validCommand().operation, kind: 'Weather Read' },
    }).success).toBe(false);
    expect(commandEnvelopeSchema.safeParse({ ...validCommand(), deadline: 'tomorrow' }).success).toBe(false);
  });
});

describe('bounded JSON values', () => {
  it('accepts ordinary JSON without mutating significant whitespace', () => {
    const value = { text: '  preserve me  ', values: [1, true, null] };
    expect(jsonValueSchema.parse(value)).toEqual(value);
  });

  it('rejects non-finite numbers and non-JSON values', () => {
    expect(jsonValueSchema.safeParse(Number.NaN).success).toBe(false);
    expect(jsonValueSchema.safeParse(new Date()).success).toBe(false);
  });

  it('caps strings, arrays, objects, and nesting', () => {
    expect(jsonValueSchema.safeParse('x'.repeat(JSON_LIMITS.maxStringLength + 1)).success).toBe(false);
    expect(jsonValueSchema.safeParse(Array.from({ length: JSON_LIMITS.maxArrayItems + 1 }, () => 1)).success).toBe(false);
    expect(jsonValueSchema.safeParse(Object.fromEntries(
      Array.from({ length: JSON_LIMITS.maxObjectKeys + 1 }, (_, index) => [`key${index}`, index]),
    )).success).toBe(false);

    let deep: unknown = 'leaf';
    for (let depth = 0; depth <= JSON_LIMITS.maxDepth; depth += 1) deep = { nested: deep };
    expect(jsonValueSchema.safeParse(deep).success).toBe(false);
  });

  it('rejects prototype-related keys', () => {
    expect(jsonValueSchema.safeParse(JSON.parse('{"__proto__":{"polluted":true}}')).success).toBe(false);
  });
});

describe('result and stable error contracts', () => {
  it('accepts successful and failed result envelopes', () => {
    expect(commandResultSchema.safeParse(validResult()).success).toBe(true);
    expect(commandResultSchema.safeParse({
      ...validResult(),
      ok: false,
      status: 'permission_denied',
      result: undefined,
      error: {
        family: 'POLICY',
        code: 'POLICY.CONFIRMATION_REQUIRED',
        message: 'Explicit confirmation is required.',
        retryable: false,
      },
    }).success).toBe(true);
  });

  it('requires exactly the error state implied by ok', () => {
    expect(commandResultSchema.safeParse({
      ...validResult(),
      error: { family: 'INTERNAL', code: 'INTERNAL.TEST', message: 'No', retryable: false },
    }).success).toBe(false);
    expect(commandResultSchema.safeParse({ ...validResult(), ok: false }).success).toBe(false);
  });

  it('enforces coherent side-effect and timing metadata', () => {
    expect(commandResultSchema.safeParse({
      ...validResult(),
      sideEffect: { attempted: false, completed: true, idempotentReplay: false },
    }).success).toBe(false);
    expect(commandResultSchema.safeParse({
      ...validResult(),
      timing: { queuedMs: 5, executionMs: 10, totalMs: 12 },
    }).success).toBe(false);
  });

  it('maps every stable error family to an HTTP status', () => {
    for (const family of jarvisErrorSchema.shape.family.options) {
      expect(ERROR_HTTP_STATUS[family]).toBeGreaterThanOrEqual(400);
      expect(ERROR_HTTP_STATUS[family]).toBeLessThan(600);
    }
  });

  it('allows automatic retry only for transient failures', () => {
    expect(jarvisErrorSchema.safeParse({
      family: 'TRANSIENT',
      code: 'TRANSIENT.TIMEOUT',
      message: 'The service timed out.',
      retryable: true,
    }).success).toBe(true);
    expect(jarvisErrorSchema.safeParse({
      family: 'EXECUTION',
      code: 'EXECUTION.UNKNOWN_SIDE_EFFECT',
      message: 'Execution stopped after the side effect may have begun.',
      retryable: true,
    }).success).toBe(false);
  });
});

describe('protocol identity', () => {
  it('validates a strict component handshake', () => {
    expect(protocolHandshakeSchema.safeParse({
      protocol: JARVIS_PROTOCOL_VERSION,
      component: 'companion',
      componentVersion: '1.1.0',
      instanceId: 'device:synthetic-001',
      features: ['screen.preview', 'input.click'],
    }).success).toBe(true);
  });

  it('creates schema-compatible opaque identifiers', () => {
    const command = {
      ...validCommand(),
      requestId: createRequestId(),
      idempotencyKey: createIdempotencyKey(),
      traceId: createTraceId(),
    };
    expect(commandEnvelopeSchema.safeParse(command).success).toBe(true);
  });
});
