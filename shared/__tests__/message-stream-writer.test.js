import { describe, it, expect, vi, afterEach } from 'vitest';
import { MessageStreamWriter } from '../message-stream-writer.ts';
import { mapAcpUpdate, acpToolCallBuilders } from '../../server/agent-sdks/acp-mapping.ts';

const acpBuilders = acpToolCallBuilders();

describe('MessageStreamWriter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards raw SDK events to appendRaw', async () => {
    const appendRaw = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow: vi.fn(),
      patchRow: vi.fn(),
      appendRaw,
      builders: acpBuilders,
    });

    await writer.log({ type: 'test', value: 1 });
    expect(appendRaw).toHaveBeenCalledWith({ type: 'test', value: 1 });
  });

  it('persists ExitPlanMode as a single plan row instead of tool_call', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 10 });
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow: vi.fn(),
      builders: acpBuilders,
    });

    const update = /** @type {any} */ ({
      sessionUpdate: 'tool_call',
      toolCallId: 'tu_plan',
      name: 'ExitPlanMode',
      status: 'completed',
      rawInput: { plan: '# Do the thing\n\nStep 1.' },
    });
    await writer.log(update);
    await writer.apply(mapAcpUpdate(update));

    expect(createRow).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(createRow.mock.calls[0][0].message_json);
    expect(payload).toEqual({ type: 'plan', markdown: '# Do the thing\n\nStep 1.' });
    expect(createRow.mock.calls[0][0].type).toBe('plan');
    expect(writer.pendingTools.has('tu_plan')).toBe(false);
  });

  it('patches one thinking_tokens row instead of creating many', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 50 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    vi.useFakeTimers();
    await writer.apply([
      {
        op: 'system',
        payload: {
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 10,
          estimated_tokens_delta: 10,
        },
      },
    ]);
    await writer.apply([
      {
        op: 'system',
        payload: {
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 14,
          estimated_tokens_delta: 4,
        },
      },
    ]);
    await vi.runAllTimersAsync();

    expect(createRow).toHaveBeenCalledTimes(1);
    expect(patchRow).toHaveBeenCalledTimes(1);
    const patch = patchRow.mock.calls[0][1];
    const patched = JSON.parse(patch.message_json);
    expect(patched).toEqual({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 14,
      estimated_tokens_delta: 4,
    });
    expect(patch.subtype).toBe('thinking_tokens');
  });

  it('buffers repeated createPlan running events into one plan row', async () => {
    const plan = '**Context:** the README needs a second joke.\n\n**Changes**\n\nEdit README.md.';
    const createRow = vi.fn().mockResolvedValue({ id: 11 });
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 3,
      createRow,
      patchRow: vi.fn(),
      builders: acpBuilders,
    });

    const feed = async (update) => {
      await writer.log(update);
      await writer.apply(mapAcpUpdate(update));
    };

    await feed(
      /** @type {any} */ ({
        sessionUpdate: 'tool_call',
        toolCallId: 'call_plan',
        name: 'createPlan',
        status: 'in_progress',
        rawInput: { plan: '' },
      })
    );
    await feed(
      /** @type {any} */ ({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_plan',
        name: 'createPlan',
        status: 'in_progress',
        rawInput: { plan: '**Context:** the README needs' },
      })
    );
    await feed(
      /** @type {any} */ ({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_plan',
        name: 'createPlan',
        status: 'in_progress',
        rawInput: { plan: '**Context:** the README needs a second joke.' },
      })
    );
    await feed(
      /** @type {any} */ ({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_plan',
        name: 'createPlan',
        status: 'completed',
        rawInput: { plan },
        rawOutput: { status: 'success', value: {} },
      })
    );

    expect(createRow).toHaveBeenCalledTimes(1);
    expect(createRow.mock.calls[0][0].type).toBe('plan');
    const payload = JSON.parse(createRow.mock.calls[0][0].message_json);
    expect(payload).toEqual({ type: 'plan', markdown: plan });
  });

  it('patches a running Task row on tool_progress', async () => {
    vi.useFakeTimers();
    const createRow = vi.fn().mockResolvedValue({ id: 40 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: {
        ...acpBuilders,
        buildToolCallProgress: (prev, raw) => ({
          ...prev,
          result: {
            step_count: raw.conversationSteps.length,
            steps: raw.conversationSteps.map((s) => ({
              kind: 'assistant',
              text: s.assistantMessage?.text,
            })),
          },
        }),
      },
    });

    await writer.apply([
      { op: 'tool_start', call_id: 'sub', name: 'Task', input: { description: 'Work' } },
      {
        op: 'tool_progress',
        call_id: 'sub',
        raw: { conversationSteps: [{ assistantMessage: { text: 'Step one.' } }] },
      },
    ]);
    expect(patchRow).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(patchRow).toHaveBeenCalledTimes(1);
    const patched = JSON.parse(patchRow.mock.calls[0][1].message_json);
    expect(patched.status).toBe('running');
    expect(patched.result.step_count).toBe(1);
    expect(patched.result.steps[0].kind).toBe('assistant');
  });

  it('debounces assistant text patches while streaming', async () => {
    vi.useFakeTimers();
    const createRow = vi.fn().mockResolvedValue({ id: 1 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    await writer.appendAssistantText('a');
    await writer.appendAssistantText('b');
    await writer.appendAssistantText('c');
    expect(patchRow).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(patchRow).toHaveBeenCalledTimes(1);
  });

  it('merges streamed bash input_json deltas into the running row', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 21 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    await writer.apply([
      { op: 'tool_stream_block_start', index: 0, call_id: 'c2', name: 'Bash', input: {} },
      { op: 'tool_stream_input_delta', index: 0, partial_json: '{"command":"echo test"' },
      {
        op: 'tool_stream_input_delta',
        index: 0,
        partial_json: ',"description":"Run echo"}',
      },
      { op: 'tool_result', call_id: 'c2', raw: 'test', is_error: false },
    ]);

    const completed = JSON.parse(patchRow.mock.calls.at(-1)[1].message_json);
    expect(completed.args.command).toBe('echo test');
    expect(completed.args.description).toBe('Run echo');
  });

  it('does not wipe bash command when tool_result carries empty input', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 22 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    await writer.apply([
      { op: 'tool_start', call_id: 'c3', name: 'Bash', input: { command: 'echo test' } },
      { op: 'tool_result', call_id: 'c3', input: {}, raw: 'test', is_error: false },
    ]);

    const completed = JSON.parse(patchRow.mock.calls.at(-1)[1].message_json);
    expect(completed.args.command).toBe('echo test');
  });

  it('merges later tool_start args into the running bash row', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 20 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    await writer.apply([
      { op: 'tool_start', call_id: 'c1', name: 'Bash', input: {} },
      { op: 'tool_start', call_id: 'c1', name: 'Bash', input: { command: 'echo test' } },
      { op: 'tool_result', call_id: 'c1', raw: 'test', is_error: false },
    ]);

    const completed = JSON.parse(patchRow.mock.calls.at(-1)[1].message_json);
    expect(completed.args.command).toBe('echo test');
  });

  it('sets turn_reply on the assistant row flushed before turn_result', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 11 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    await writer.apply([{ op: 'assistant_text', text: 'All done.' }]);
    await writer.persistTurnResult({
      type: 'turn_result',
      status: 'ok',
      error_message: null,
      total_cost_usd: 0.01,
    });

    expect(patchRow).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(patchRow.mock.calls[0][1].message_json);
    expect(payload.turn_reply).toBe(true);
    expect(payload.blocks[0].text).toBe('All done.');
    expect(createRow).toHaveBeenCalledTimes(2);
    const turnResult = JSON.parse(createRow.mock.calls[1][0].message_json);
    expect(turnResult.type).toBe('turn_result');
  });

  it('marks pending tools cancelled when finish() runs', async () => {
    const createRow = vi.fn().mockResolvedValue({ id: 20 });
    const patchRow = vi.fn().mockResolvedValue(undefined);
    const writer = new MessageStreamWriter({
      sessionId: 1,
      turnId: 2,
      createRow,
      patchRow,
      builders: acpBuilders,
    });

    await writer.startTool('tool-1', 'Bash', { command: 'sleep 9' });
    await writer.finish();

    expect(patchRow).toHaveBeenCalled();
    const payload = JSON.parse(patchRow.mock.calls[0][1].message_json);
    expect(payload.status).toBe('cancelled');
  });
});
