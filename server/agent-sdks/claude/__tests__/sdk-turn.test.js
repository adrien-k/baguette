import { describe, expect, it } from 'vitest';
import { processClaudeQueryStream } from '../sdk-turn.ts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const initMessage = () => ({
  type: 'system',
  subtype: 'init',
  session_id: 'sess-1',
  uuid: 'u-init',
});

const assistantMessage = (text) => ({
  type: 'assistant',
  message: {
    id: `msg-${text.slice(0, 6)}`,
    model: 'claude-sonnet-5-5',
    role: 'assistant',
    content: [{ type: 'text', text }],
  },
  session_id: 'sess-1',
  uuid: 'u-asst',
});

/** The empty result the CLI flushes right after init when a resume replays a turn that died mid tool call. */
const modelLessResult = () => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 0,
  result: '',
  duration_api_ms: 0,
  total_cost_usd: 1.5,
  session_id: 'sess-1',
  uuid: 'u-model-less',
});

const realResult = (overrides = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  result: 'Done.',
  duration_api_ms: 1200,
  total_cost_usd: 2.5,
  session_id: 'sess-1',
  uuid: 'u-real',
  ...overrides,
});

async function* streamOf(messages, { throwsAtEnd = null } = {}) {
  for (const message of messages) yield message;
  if (throwsAtEnd) throw throwsAtEnd;
}

function fakeWriter() {
  const state = { logged: [], ops: [] };
  return {
    state,
    log: async (m) => state.logged.push(m),
    apply: async (ops) => state.ops.push(...(ops ?? [])),
  };
}

function turnResultOps(ops) {
  return ops.filter((op) => op.op === 'turn_result');
}

// ─── Model-less result handling ───────────────────────────────────────────────

describe('processClaudeQueryStream - model-less results', () => {
  it('keeps the turn open after a model-less result and completes on the real one', async () => {
    const writer = fakeWriter();
    const onResultCalls = [];
    const result = await processClaudeQueryStream(
      streamOf([
        initMessage(),
        modelLessResult(),
        assistantMessage('continuing the resumed turn'),
        realResult(),
      ]),
      {
        writer,
        trackBackgroundTasks: true,
        onResult: async (m) => onResultCalls.push(m),
      }
    );

    expect(result.turnComplete).toBe(true);
    expect(result.outcome).toBe('completed');
    expect(result.lastResult.result).toBe('Done.');
    // The real verdict decided the turn; the model-less flush never reached onResult.
    expect(onResultCalls).toHaveLength(1);
    expect(onResultCalls[0].result).toBe('Done.');
    // Only the real result writes the turn_result row.
    expect(turnResultOps(writer.state.ops)).toHaveLength(1);
    expect(turnResultOps(writer.state.ops)[0].payload.total_cost_usd).toBe(2.5);
  });

  it('closes the turn out with a model-less result when the stream ends without a real one', async () => {
    const writer = fakeWriter();
    const onResultCalls = [];
    const result = await processClaudeQueryStream(streamOf([initMessage(), modelLessResult()]), {
      writer,
      trackBackgroundTasks: true,
      onResult: async (m) => onResultCalls.push(m),
    });

    // Not a silent failure: the model-less result is the fallback verdict.
    expect(result.turnComplete).toBe(true);
    expect(result.outcome).toBe('completed');
    expect(result.lastResult.result).toBe('');
    expect(onResultCalls).toHaveLength(1);
    expect(onResultCalls[0].num_turns).toBe(0);
    expect(turnResultOps(writer.state.ops)).toHaveLength(1);
    expect(turnResultOps(writer.state.ops)[0].payload.status).toBe('ok');
  });

  it('does not report completion when the stream errors after a model-less result', async () => {
    const writer = fakeWriter();
    const onResultCalls = [];
    const onStreamErrorCalls = [];
    const result = await processClaudeQueryStream(
      streamOf([initMessage(), modelLessResult()], { throwsAtEnd: new Error('stream broke') }),
      {
        writer,
        trackBackgroundTasks: true,
        onResult: async (m) => onResultCalls.push(m),
        onStreamError: async (err) => onStreamErrorCalls.push(err),
      }
    );

    expect(result.turnComplete).toBe(false);
    expect(result.streamFailed).toBe(true);
    expect(result.outcome).toBe('failed');
    expect(onStreamErrorCalls).toHaveLength(1);
    expect(onResultCalls).toHaveLength(0);
  });

  it('still completes on a plain real result (no model-less involved)', async () => {
    const writer = fakeWriter();
    const onResultCalls = [];
    const result = await processClaudeQueryStream(streamOf([initMessage(), realResult()]), {
      writer,
      onResult: async (m) => onResultCalls.push(m),
    });

    expect(result.turnComplete).toBe(true);
    expect(result.outcome).toBe('completed');
    expect(onResultCalls).toHaveLength(1);
    expect(turnResultOps(writer.state.ops)).toHaveLength(1);
  });
});
