import { describe, it, expect } from 'vitest';
import { processCursorRunStream } from '../cursor-sdk-turn.js';

function mockRun(events) {
  return {
    stream: async function* () {
      for (const e of events) yield e;
    },
  };
}

describe('processCursorRunStream', () => {
  it('buffers assistant text chunks into one message', async () => {
    const persisted = [];
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
        persistMessage: async (msg) => {
          persisted.push(msg);
          return { id: persisted.length };
        },
        patchMessage: async () => {},
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    const assistant = persisted.find((m) => m.message?.content?.[0]?.type === 'text');
    expect(assistant.message.content[0].text).toBe('Hi there');
    expect(persisted.filter((m) => m.message?.content?.[0]?.type === 'text')).toHaveLength(1);
  });

  it('buffers thinking chunks into one message', async () => {
    const persisted = [];
    await processCursorRunStream(
      mockRun([
        { type: 'thinking', agent_id: 'a', run_id: 'r', text: 'think ' },
        { type: 'thinking', agent_id: 'a', run_id: 'r', text: 'more' },
        { type: 'status', status: 'FINISHED' },
      ]),
      {
        persistMessage: async (msg) => {
          persisted.push(msg);
          return { id: persisted.length };
        },
        patchMessage: async () => {},
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    expect(persisted).toHaveLength(1);
    expect(persisted[0].message.content[0]).toEqual({ type: 'thinking', thinking: 'think more' });
  });

  it('drains tool results that arrive after FINISHED before ending the run', async () => {
    const callId = 'shell-1';
    const persisted = [];
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
        persistMessage: async (msg) => {
          persisted.push(msg);
          return { id: persisted.length };
        },
        patchMessage: async () => {},
        onStatus: async (sdkMsg) => {
          if (sdkMsg.status === 'FINISHED') return { break: true, finishedOk: true };
        },
      }
    );

    expect(finishedOk).toBe(true);
    expect(persisted.some((m) => m.message?.content?.[0]?.type === 'tool_result')).toBe(true);
  });
});
