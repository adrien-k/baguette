import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { CURSOR_TOOL_CALL_RESULT_RETAIN_MS, toolListToCursorCustomTools } from '../adapt-tools.js';

function echoTools(handler) {
  return toolListToCursorCustomTools([
    { name: 'Echo', description: 'echo', schema: { n: z.number() }, handler },
  ]);
}

describe('toolListToCursorCustomTools', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps a generic tool list to a Cursor customTools record', async () => {
    const handler = vi.fn(async (args) => ({ ok: true, n: args.n }));
    const tools = echoTools(handler);
    expect(tools.Echo.description).toBe('echo');
    expect(tools.Echo.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
    await expect(tools.Echo.execute({ n: 1 })).resolves.toEqual({ ok: true, n: 1 });
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('omits inputSchema when the schema is empty', () => {
    const tools = toolListToCursorCustomTools([
      { name: 'NoArgs', description: 'none', schema: {}, handler: async () => ({}) },
    ]);
    expect(tools.NoArgs.inputSchema).toBeUndefined();
  });

  it('joins a repeated execute for the same toolCallId to the in-flight call', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async (args) => {
      await gate;
      return { ok: true, n: args.n };
    });
    const tools = echoTools(handler);

    const first = tools.Echo.execute({ n: 1 }, { toolCallId: 'call-inflight' });
    const second = tools.Echo.execute({ n: 1 }, { toolCallId: 'call-inflight' });
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toEqual({ ok: true, n: 1 });
    await expect(second).resolves.toEqual({ ok: true, n: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reuses the in-flight call when the tool list is rebuilt', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      await gate;
      return { ok: true };
    });
    const rebuilt = vi.fn(async () => ({ ok: false }));
    const firstTools = echoTools(handler);
    const pending = firstTools.Echo.execute({}, { toolCallId: 'call-rebuild' });
    const secondTools = echoTools(rebuilt);
    const joined = secondTools.Echo.execute({}, { toolCallId: 'call-rebuild' });

    release();
    await expect(pending).resolves.toEqual({ ok: true });
    await expect(joined).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(rebuilt).not.toHaveBeenCalled();
  });

  it('returns the cached result for a retry after the call has finished', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const tools = echoTools(handler);
    await tools.Echo.execute({}, { toolCallId: 'call-done' });
    await expect(tools.Echo.execute({}, { toolCallId: 'call-done' })).resolves.toEqual({
      ok: true,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('caches a synchronous throw so a retry does not run the handler again', async () => {
    const handler = vi.fn(() => {
      throw new Error('sync');
    });
    const tools = echoTools(handler);
    await expect(tools.Echo.execute({}, { toolCallId: 'call-sync' })).rejects.toThrow('sync');
    await expect(tools.Echo.execute({}, { toolCallId: 'call-sync' })).rejects.toThrow('sync');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns the cached rejection so a retry does not run the handler again', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const tools = echoTools(handler);
    await expect(tools.Echo.execute({}, { toolCallId: 'call-bad' })).rejects.toThrow('boom');
    await expect(tools.Echo.execute({}, { toolCallId: 'call-bad' })).rejects.toThrow('boom');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs again for a different toolCallId and when the id is missing', async () => {
    const handler = vi.fn(async (args) => ({ ok: true, n: args.n }));
    const tools = echoTools(handler);
    await tools.Echo.execute({ n: 1 }, { toolCallId: 'call-a' });
    await tools.Echo.execute({ n: 2 }, { toolCallId: 'call-b' });
    await tools.Echo.execute({ n: 3 });
    await tools.Echo.execute({ n: 4 }, {});
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('runs the handler again after the cached result expires', async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => ({ ok: true }));
    const tools = echoTools(handler);
    await tools.Echo.execute({}, { toolCallId: 'call-expire' });
    await tools.Echo.execute({}, { toolCallId: 'call-expire' });
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CURSOR_TOOL_CALL_RESULT_RETAIN_MS);
    await expect(tools.Echo.execute({}, { toolCallId: 'call-expire' })).resolves.toEqual({
      ok: true,
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
