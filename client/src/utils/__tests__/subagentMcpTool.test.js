import { describe, it, expect } from 'vitest';
import {
  findSessionAgentForSubagentTool,
  resolveSubagentForMcpToolCall,
  resolveSubagentTargetFromMcpTool,
  subagentLastAssistantPreview,
  subagentToolHasStableIdentity,
} from '../subagentMcpTool.js';

const agents = [
  { id: 10, ref: 2, name: 'Research', agent_type: 'subagent' },
  { id: 11, ref: 3, name: 'Fix tests', agent_type: 'subagent' },
  { id: 12, ref: 4, name: 'Research', agent_type: 'subagent' },
  { id: 1, ref: 1, name: 'Builder', agent_type: 'builder', is_primary: 1 },
];

describe('resolveSubagentTargetFromMcpTool', () => {
  it('reads agent_id and ref from StartSubagent result', () => {
    expect(
      resolveSubagentTargetFromMcpTool(
        'StartSubagent',
        { name: 'Research' },
        {
          ok: true,
          agent_id: 10,
          ref: 2,
          status: 'completed',
        }
      )
    ).toEqual({
      agentId: 10,
      agentRef: 2,
      name: 'Research',
      status: 'completed',
    });
  });

  it('uses AwaitSubagent args when result is missing', () => {
    expect(resolveSubagentTargetFromMcpTool('AwaitSubagent', { agent_ref: 3 }, null)).toEqual({
      agentId: null,
      agentRef: 3,
      name: null,
      status: null,
    });
  });
});

describe('findSessionAgentForSubagentTool', () => {
  it('matches by id or ref only', () => {
    expect(findSessionAgentForSubagentTool(agents, { agentId: 10 })).toEqual(agents[0]);
    expect(findSessionAgentForSubagentTool(agents, { agentRef: 3 })).toEqual(agents[1]);
    expect(findSessionAgentForSubagentTool(agents, { name: 'Research' })).toBeNull();
  });
});

describe('subagentToolHasStableIdentity', () => {
  it('requires agent_id or agent_ref', () => {
    expect(subagentToolHasStableIdentity({ agentId: 5, agentRef: null, name: 'x' })).toBe(true);
    expect(subagentToolHasStableIdentity({ agentId: null, agentRef: 2, name: 'x' })).toBe(true);
    expect(subagentToolHasStableIdentity({ agentId: null, agentRef: null, name: 'Research' })).toBe(
      false
    );
  });
});

describe('subagentLastAssistantPreview', () => {
  it('extracts text blocks from legacy message.content envelope', () => {
    expect(
      subagentLastAssistantPreview({
        ok: true,
        last_assistant_message: {
          message: { content: [{ type: 'text', text: 'Done.' }] },
        },
      })
    ).toBe('Done.');
  });

  it('extracts text from typed assistant message_json (summarizeAssistantMessage shape)', () => {
    const message_json = JSON.stringify({
      type: 'assistant',
      blocks: [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: 'Shipped the fix.' },
      ],
    });
    expect(
      subagentLastAssistantPreview({
        ok: true,
        last_assistant_message: {
          id: 99,
          type: 'assistant',
          message: null,
          message_json,
        },
      })
    ).toBe('Shipped the fix.');
  });
});

describe('resolveSubagentForMcpToolCall', () => {
  it('joins parsed result with session agents', () => {
    const resolved = resolveSubagentForMcpToolCall(
      agents,
      'StartSubagent',
      { name: 'Fix tests' },
      { ok: true, agent_id: 11, ref: 3, status: 'running' }
    );
    expect(resolved.agent).toEqual(agents[1]);
    expect(resolved.agentId).toBe(11);
  });
});
