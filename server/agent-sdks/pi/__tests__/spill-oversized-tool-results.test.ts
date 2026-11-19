import { describe, it, expect, vi } from 'vitest';
import { createSpillOversizedToolResultsExtension } from '../extensions/spill-oversized-tool-results.ts';
import { MAX_TOOL_RESULT_BYTES } from '../../../services/mcp/lib/spill-oversized-results.js';

vi.mock('../../../services/agent-turn-compaction.js', () => ({
  getBaguetteToolMessageCompactionHook: () => null,
}));

const spillOversizedToolResultsExtension = createSpillOversizedToolResultsExtension();
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function makePi() {
  const handlers = {};
  return {
    on(event, handler) {
      handlers[event] = handler;
      return () => {};
    },
    handlers,
  };
}

const hugeText = 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1000);

async function makeCwd() {
  return mkdtemp(path.join(tmpdir(), 'pi-spill-'));
}

describe('spillOversizedToolResultsExtension', () => {
  it('registers tool_result and context handlers', () => {
    const pi = makePi();
    spillOversizedToolResultsExtension(pi);
    expect(typeof pi.handlers.tool_result).toBe('function');
    expect(typeof pi.handlers.context).toBe('function');
  });

  it('spills oversized tool_result text blocks and points at the file', async () => {
    const pi = makePi();
    spillOversizedToolResultsExtension(pi);
    const cwd = await makeCwd();
    const result = await pi.handlers.tool_result(
      { toolName: 'PrWorkflowLogs', content: [{ type: 'text', text: hugeText }] },
      { cwd }
    );
    const text = result.content[0].text;
    expect(text).toContain('Full output saved to');
    expect(text).toMatch(/PrWorkflowLogs-[0-9a-f]{12}\.txt/);
    const spilledPath = text.match(/saved to (\S+)\.$/m)[1];
    expect(await readFile(path.join(cwd, spilledPath), 'utf8')).toBe(hugeText);
  });

  it('leaves small tool results untouched', async () => {
    const pi = makePi();
    spillOversizedToolResultsExtension(pi);
    const event = { toolName: 'Read', content: [{ type: 'text', text: 'small' }] };
    expect(await pi.handlers.tool_result(event, { cwd: '.' })).toBeUndefined();
  });

  it('spills oversized persisted toolResult messages in the context transform', async () => {
    const pi = makePi();
    spillOversizedToolResultsExtension(pi);
    const cwd = await makeCwd();
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'PrWorkflowLogs',
        content: [{ type: 'text', text: hugeText }],
        isError: false,
      },
      {
        role: 'toolResult',
        toolCallId: 't2',
        toolName: 'Read',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    ];
    const result = await pi.handlers.context({ messages }, { cwd });
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[2]).toBe(messages[2]);
    const text = result.messages[1].content[0].text;
    expect(text).toContain('Full output saved to');
    expect(text.length).toBeLessThan(1000);
    const spilledPath = text.match(/saved to (\S+)\.$/m)[1];
    expect(await readFile(path.join(cwd, spilledPath), 'utf8')).toBe(hugeText);
  });

  it('returns undefined when the context has no oversized results', async () => {
    const pi = makePi();
    spillOversizedToolResultsExtension(pi);
    const messages = [
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'Read',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    ];
    expect(await pi.handlers.context({ messages }, { cwd: '.' })).toBeUndefined();
  });
});
