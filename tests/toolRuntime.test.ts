import { describe, expect, it, vi } from 'vitest';
import { ToolRuntime, type ToolConfirmationRequest } from '../frontend/lib/tools/runtime';
import type { JarvisFunction } from '../frontend/lib/functions';

function fn(name: string, handler: (args: Record<string, unknown>) => unknown): JarvisFunction {
  return {
    name,
    label: name,
    description: name,
    tool: { type: 'function', name, description: name, parameters: {} },
    handler,
  };
}

function runtime(options: {
  functions?: JarvisFunction[];
  enabled?: string[];
  isDesktop?: boolean;
  confirm?: (request: ToolConfirmationRequest) => Promise<boolean>;
} = {}) {
  const calls: string[] = [];
  const functions = options.functions ?? [
    fn('get_time', () => { calls.push('get_time'); return { time: '12:00' }; }),
    fn('run_shell_command', () => { calls.push('run_shell_command'); return { ok: true }; }),
    fn('navigate_to_page', () => { calls.push('navigate_to_page'); return { ok: true }; }),
    fn('take_photo', () => { calls.push('take_photo'); return { ok: true }; }),
  ];
  const confirm = options.confirm ?? (async () => true);
  const instance = new ToolRuntime(functions, {
    actorId: 'desktop-user:test',
    isDesktop: options.isDesktop ?? true,
    sessionId: 'session:test',
    confirm,
  });
  instance.syncEnabledOperations(options.enabled ?? ['get_time', 'run_shell_command', 'navigate_to_page', 'take_photo']);
  return { runtime: instance, calls };
}

describe('static tool runtime', () => {
  it('runs an enabled public read without confirming', async () => {
    const confirm = vi.fn(async () => true);
    const { runtime: instance, calls } = runtime({ confirm });
    const result = await instance.invoke({ name: 'get_time', args: {}, source: 'model' });
    expect(result?.ok).toBe(true);
    expect(calls).toEqual(['get_time']);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses a disabled tool even when the model asks for it by name', async () => {
    const { runtime: instance, calls } = runtime({ enabled: ['get_time'] });
    const result = await instance.invoke({ name: 'run_shell_command', args: { command: 'ls' }, source: 'model' });
    expect(result?.ok).toBe(false);
    expect(result?.error?.code).toBe('POLICY.ABILITY_DISABLED');
    expect(calls).toEqual([]);
  });

  it('will not run a privileged tool without confirmation, and never runs it when declined', async () => {
    const confirm = vi.fn(async () => false);
    const { runtime: instance, calls } = runtime({ confirm });
    const result = await instance.invoke({ name: 'run_shell_command', args: { command: 'rm -rf /' }, source: 'model' });
    expect(result?.ok).toBe(false);
    expect(result?.error?.code).toBe('POLICY.USER_DECLINED');
    expect(confirm).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });

  it('runs a privileged tool once the user approves', async () => {
    const { runtime: instance, calls } = runtime();
    const result = await instance.invoke({ name: 'run_shell_command', args: { command: 'ls' }, source: 'model' });
    expect(result?.ok).toBe(true);
    expect(calls).toEqual(['run_shell_command']);
  });

  it('shows the user what they are approving', async () => {
    let seen: ToolConfirmationRequest | undefined;
    const { runtime: instance } = runtime({
      confirm: async (request) => { seen = request; return true; },
    });
    await instance.invoke({ name: 'run_shell_command', args: { command: 'whoami' }, source: 'model' });
    expect(seen).toMatchObject({
      operation: 'run_shell_command',
      risk: 'local-privileged',
      args: { command: 'whoami' },
    });
  });

  it('confirms when-model tools for model calls but not for direct user actions', async () => {
    const confirm = vi.fn(async () => true);
    const { runtime: instance } = runtime({ confirm });
    await instance.invoke({ name: 'take_photo', args: {}, source: 'user' });
    expect(confirm).not.toHaveBeenCalled();
    await instance.invoke({ name: 'take_photo', args: {}, source: 'model' });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('treats a user action carrying untrusted input like a model proposal', async () => {
    const confirm = vi.fn(async () => true);
    const { runtime: instance } = runtime({ confirm });
    await instance.invoke({ name: 'take_photo', args: {}, source: 'user', untrustedInput: true });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('denies local-privileged tools to a LAN browser, approval or not', async () => {
    const { runtime: instance, calls } = runtime({ isDesktop: false });
    const result = await instance.invoke({ name: 'run_shell_command', args: { command: 'ls' }, source: 'model' });
    expect(result?.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('rejects arguments that do not match the declared schema', async () => {
    const { runtime: instance, calls } = runtime();
    const result = await instance.invoke({ name: 'run_shell_command', args: { command: 42 }, source: 'model' });
    expect(result?.ok).toBe(false);
    expect(result?.error?.code).toBe('VALIDATION.INVALID_ARGUMENTS');
    expect(calls).toEqual([]);
  });

  it('revokes access as soon as the user disables a tool', async () => {
    const { runtime: instance, calls } = runtime();
    expect((await instance.invoke({ name: 'take_photo', args: {}, source: 'model' }))?.ok).toBe(true);
    instance.syncEnabledOperations(['get_time']);
    const result = await instance.invoke({ name: 'take_photo', args: {}, source: 'model' });
    expect(result?.ok).toBe(false);
    expect(calls).toEqual(['take_photo']);
  });

  it('returns null for tools outside the static catalog so callers can fall back', async () => {
    const { runtime: instance } = runtime();
    expect(await instance.invoke({ name: 'some_mcp_tool', args: {}, source: 'model' })).toBeNull();
  });

  it('advertises only enabled tools', () => {
    const all = [fn('get_time', () => null), fn('run_shell_command', () => null)];
    const { runtime: instance } = runtime({ enabled: ['get_time'] });
    expect(instance.advertisedFunctions(all).map((tool) => tool.name)).toEqual(['get_time']);
  });
});
