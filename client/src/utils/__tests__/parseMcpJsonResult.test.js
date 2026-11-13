import { describe, it, expect } from 'vitest';
import { parseMcpJsonResult } from '../parseMcpJsonResult.ts';

function wrapMcpJson(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

describe('parseMcpJsonResult', () => {
  it('unwraps EditPlan-style markdown from MCP text content blocks', () => {
    const wrapped = wrapMcpJson({
      ok: true,
      markdown: '## Plan\n\nStep one',
    });
    const parsed = parseMcpJsonResult(wrapped);
    expect(parsed?.ok).toBe(true);
    expect(parsed?.markdown).toBe('## Plan\n\nStep one');
  });

  it('unwraps UpdateTodo-style todo from MCP text content blocks', () => {
    const wrapped = wrapMcpJson({
      ok: true,
      todo: { id: 3, ref: 7, content: 'Fix cards', status: 'in_progress' },
      todos: [],
    });
    const parsed = parseMcpJsonResult(wrapped);
    expect(parsed?.ok).toBe(true);
    expect(parsed?.todo).toEqual({
      id: 3,
      ref: 7,
      content: 'Fix cards',
      status: 'in_progress',
    });
  });

  it('parses plain JSON objects without a wrapper', () => {
    const parsed = parseMcpJsonResult({ ok: true, markdown: 'Direct' });
    expect(parsed?.markdown).toBe('Direct');
  });

  it('parses JSON strings', () => {
    const parsed = parseMcpJsonResult(JSON.stringify({ ok: true, markdown: 'From string' }));
    expect(parsed?.markdown).toBe('From string');
  });

  it('flattens a nested subagent payload from { data: { agent_id, ref, subagent } }', () => {
    const parsed = parseMcpJsonResult({
      data: {
        agent_id: 42,
        ref: 3,
        subagent: { agent_id: 42, ref: 3, name: 'worker' },
      },
    });
    expect(parsed?.agent_id).toBe(42);
    expect(parsed?.ref).toBe(3);
    expect(parsed?.subagent).toEqual({ agent_id: 42, ref: 3, name: 'worker' });
  });
});
