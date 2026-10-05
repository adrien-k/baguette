import { describe, it, expect } from 'vitest';
import { processCursorRunStream } from '../cursor-sdk-turn.js';
import { MessageStreamWriter } from '../../../shared/message-stream-writer.js';

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
  });
  return { writer, rows };
}

describe('processCursorRunStream', () => {
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

  it('treats FINISHED as success when the stream ends before a pending tool completes', async () => {
    const { writer } = mockWriter();
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
  });
});
