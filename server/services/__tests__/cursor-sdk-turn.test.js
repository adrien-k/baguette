import { describe, it, expect } from 'vitest';
import {
  cursorSdkMessageIndicatesBackgroundWork,
  processCursorRunStream,
} from '../cursor/cursor-sdk-turn.ts';
import { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import { cursorBuildToolCallStart, cursorBuildToolCallComplete } from '../cursor/cursor-mapping.ts';

const cursorBuilders = {
  buildToolCallStart: cursorBuildToolCallStart,
  buildToolCallComplete: cursorBuildToolCallComplete,
};

function mockRun(events) {
  return {
    stream: async function* () {
      for (const e of events) yield e;
    },
  };
}

function mockWriter() {
  const rows = [];
  const writer = new MessageStreamWriter({
    sessionId: 1,
    turnId: 1,
    createRow: async (row) => {
      const payload = JSON.parse(row.message_json);
      rows.push(payload);
      return { id: rows.length };
    },
    patchRow: async (id, patch) => {
      rows[id - 1] = JSON.parse(patch.message_json);
    },
    builders: cursorBuilders,
  });
  return { writer, rows };
}

describe('cursorSdkMessageIndicatesBackgroundWork', () => {
  it('returns true for SDK task events', () => {
    expect(cursorSdkMessageIndicatesBackgroundWork({ type: 'task', text: 'spawned' })).toBe(true);
  });

  it('returns true for Task tool calls with run_in_background', () => {
    expect(
      cursorSdkMessageIndicatesBackgroundWork({
        type: 'tool_call',
        name: 'Task',
        status: 'running',
        args: { run_in_background: true },
      })
    ).toBe(true);
  });

  it('returns false for foreground Task tool calls', () => {
    expect(
      cursorSdkMessageIndicatesBackgroundWork({
        type: 'tool_call',
        name: 'Task',
        status: 'running',
        args: { description: 'explore' },
      })
    ).toBe(false);
  });
});

describe('processCursorRunStream', () => {
  it('sets hasBackgroundTask when a background Task tool call runs', async () => {
    const { writer } = mockWriter();
    const { hasBackgroundTask } = await processCursorRunStream(
      mockRun([
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'task-1',
          name: 'Task',
          args: { run_in_background: true, description: 'sub' },
          agent_id: 'a',
          run_id: 'r',
        },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );
    expect(hasBackgroundTask).toBe(true);
  });

  it('buffers assistant text chunks into one message', async () => {
    const { writer, rows } = mockWriter();
    await processCursorRunStream(
      mockRun([
        {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hi ' }] },
        },
        {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'there' }] },
        },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    const assistant = rows.find((m) => m.type === 'assistant');
    expect(assistant.blocks[0].text).toBe('Hi there');
    expect(rows.filter((m) => m.type === 'assistant')).toHaveLength(1);
  });

  it('buffers thinking chunks into one message', async () => {
    const { writer, rows } = mockWriter();
    await processCursorRunStream(
      mockRun([
        { type: 'thinking', agent_id: 'a', run_id: 'r', text: 'think ' },
        { type: 'thinking', agent_id: 'a', run_id: 'r', text: 'more' },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].blocks[0]).toEqual({ type: 'thinking', thinking: 'think more' });
  });

  it('completes tool calls without separate tool_result user rows', async () => {
    const callId = 'shell-1';
    const { writer, rows } = mockWriter();
    const { finishedOk } = await processCursorRunStream(
      mockRun([
        {
          type: 'tool_call',
          status: 'running',
          call_id: callId,
          name: 'Shell',
          args: { command: 'git commit' },
          agent_id: 'a',
          run_id: 'r',
        },
        { type: 'status', status: 'FINISHED' },
        {
          type: 'tool_call',
          status: 'completed',
          call_id: callId,
          name: 'Shell',
          args: { command: 'git commit' },
          agent_id: 'a',
          run_id: 'r',
          result: { exitCode: 0 },
        },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    expect(finishedOk).toBe(true);
    const tool = rows.find((m) => m.type === 'tool_call');
    expect(tool.status).toBe('completed');
    expect(tool.result).toBeTruthy();
    expect(rows.some((m) => m.type === 'user')).toBe(false);
  });

  it('does not let repeated createPlan deltas hold the stream open or fan out rows', async () => {
    const plan = '**Context:** plan body.\n\n**Changes**\n\nEdit README.md.';
    const { writer, rows } = mockWriter();
    const { finishedOk } = await processCursorRunStream(
      mockRun([
        // Same shape the cursor SDK emits: cumulative running deltas, one completion.
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'call_plan',
          name: 'createPlan',
          args: { plan: '' },
          agent_id: 'a',
          run_id: 'r',
        },
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'call_plan',
          name: 'createPlan',
          args: { plan: '**Context:** plan body.' },
          agent_id: 'a',
          run_id: 'r',
        },
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'call_plan',
          name: 'createPlan',
          args: { plan: '**Context:** plan body.\n\n**Changes**' },
          agent_id: 'a',
          run_id: 'r',
        },
        {
          type: 'tool_call',
          status: 'completed',
          call_id: 'call_plan',
          name: 'createPlan',
          args: { plan },
          result: { status: 'success', value: {} },
          agent_id: 'a',
          run_id: 'r',
        },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    // FINISHED must break the loop (no leaked pending tools), and the plan is a single row.
    expect(finishedOk).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('plan');
    expect(rows[0].markdown).toBe(plan);
  });

  it('treats FINISHED as success when the stream ends before a pending tool completes', async () => {
    const { writer, rows } = mockWriter();
    const { finishedOk } = await processCursorRunStream(
      mockRun([
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'shell-stuck',
          name: 'Shell',
          args: { command: 'git push' },
          agent_id: 'a',
          run_id: 'r',
        },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    expect(finishedOk).toBe(true);
    const tool = rows.find((m) => m.type === 'tool_call');
    expect(tool.status).toBe('cancelled');
  });

  it('does not fail the turn when the SDK abandons an in-flight tool call', async () => {
    // Real-world shape: a parallel `read` fires before createPlan and the SDK never
    // emits its completed event — the stream ends right after FINISHED.
    const plan = '**Context:** plan body.';
    const { writer, rows } = mockWriter();
    const { finishedOk } = await processCursorRunStream(
      mockRun([
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'call_read',
          name: 'read',
          args: { path: 'README.md' },
          agent_id: 'a',
          run_id: 'r',
        },
        {
          type: 'tool_call',
          status: 'running',
          call_id: 'call_plan',
          name: 'createPlan',
          args: { plan: '' },
          agent_id: 'a',
          run_id: 'r',
        },
        {
          type: 'tool_call',
          status: 'completed',
          call_id: 'call_plan',
          name: 'createPlan',
          args: { plan },
          result: { status: 'success', value: {} },
          agent_id: 'a',
          run_id: 'r',
        },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    expect(finishedOk).toBe(true);
    const tool = rows.find((m) => m.type === 'tool_call');
    expect(tool.status).toBe('cancelled');
    const planRow = rows.find((m) => m.type === 'plan');
    expect(planRow.markdown).toBe(plan);
  });

  it('keeps a terminal error verdict even when no tools are pending', async () => {
    const { writer, rows } = mockWriter();
    const { finishedOk } = await processCursorRunStream(
      mockRun([{ type: 'status', status: 'ERROR', message: 'boom' }]),
      {
        writer,
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'ERROR') return { break: true, finishedOk: false };
        },
      }
    );

    expect(finishedOk).toBe(false);
    expect(rows).toHaveLength(0);
  });
});
