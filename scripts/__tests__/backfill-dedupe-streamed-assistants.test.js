import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../server/test-utils/db.js';
import {
  coalesceStringParts,
  collapseStreamableAssistantRun,
  collapseThinkingTokensRun,
  dedupeStreamedAssistantRows,
  dedupeThinkingTokenRows,
  isStreamableAssistantRow,
  isThinkingTokensRow,
} from '../2026100602_backfill-dedupe-streamed-assistants.js';

const db = createTestDb({ beforeEach, afterEach });

async function seedSession(shortId) {
  const [userId] = await db('users').insert({
    github_id: 1,
    username: 't',
    approved: true,
  });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: shortId,
    initial_prompt: 'x',
    base_branch: 'main',
    local_branch: 'feat',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_sdk: 'cursor',
    model: 'sonnet',
  });
  return sessionId;
}

function legacyAssistant(text) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function legacyAssistantThinking(thinking) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking }] },
  });
}

describe('backfill-dedupe-streamed-assistants', () => {
  it('detects streamable assistant rows without tool_use', () => {
    expect(
      isStreamableAssistantRow({
        type: 'assistant',
        message_json: legacyAssistant('hi'),
      })
    ).toBe(true);
    expect(
      isStreamableAssistantRow({
        type: 'assistant',
        message_json: JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }],
          },
        }),
      })
    ).toBe(false);
  });

  it('collapseStreamableAssistantRun keeps longest prefix chain', () => {
    const rows = [
      { id: 1, type: 'assistant', message_json: legacyAssistant('Hi') },
      { id: 2, type: 'assistant', message_json: legacyAssistant('Hi there') },
      { id: 3, type: 'assistant', message_json: legacyAssistant('Hi there!') },
    ];
    const plan = collapseStreamableAssistantRun(rows);
    expect(plan).not.toBeNull();
    expect(plan.keepId).toBe(3);
    expect(plan.deleteIds).toEqual([1, 2]);
    expect(JSON.parse(plan.message_json)).toEqual({
      type: 'assistant',
      blocks: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('coalesceStringParts prefix-collapses thinking tokens', () => {
    expect(coalesceStringParts(['think', 'think hard', 'think harder'])).toBe('think harder');
    expect(coalesceStringParts(['tok', 'en'])).toBe('token');
  });

  it('collapseStreamableAssistantRun keeps longest thinking prefix chain', () => {
    const rows = [
      { id: 1, type: 'assistant', message_json: legacyAssistantThinking('Hmm') },
      { id: 2, type: 'assistant', message_json: legacyAssistantThinking('Hmm...') },
      { id: 3, type: 'assistant', message_json: legacyAssistantThinking('Hmm... ok') },
    ];
    const plan = collapseStreamableAssistantRun(rows);
    expect(plan.keepId).toBe(3);
    expect(plan.deleteIds).toEqual([1, 2]);
    expect(JSON.parse(plan.message_json)).toEqual({
      type: 'assistant',
      blocks: [{ type: 'thinking', thinking: 'Hmm... ok' }],
    });
  });

  it('collapseStreamableAssistantRun concatenates delta thinking chunks', () => {
    const rows = [
      { id: 20, type: 'assistant', message_json: legacyAssistantThinking('rea') },
      { id: 21, type: 'assistant', message_json: legacyAssistantThinking('son') },
    ];
    const plan = collapseStreamableAssistantRun(rows);
    expect(plan.keepId).toBe(20);
    expect(JSON.parse(plan.message_json).blocks[0].thinking).toBe('reason');
  });

  it('collapseStreamableAssistantRun concatenates delta chunks', () => {
    const rows = [
      { id: 10, type: 'assistant', message_json: legacyAssistant('Hel') },
      { id: 11, type: 'assistant', message_json: legacyAssistant('lo') },
    ];
    const plan = collapseStreamableAssistantRun(rows);
    expect(plan.keepId).toBe(10);
    expect(plan.deleteIds).toEqual([11]);
    expect(JSON.parse(plan.message_json).blocks[0].text).toBe('Hello');
  });

  it('dedupeStreamedAssistantRows collapses runs per session', async () => {
    const sessionId = await seedSession('dedupe');
    const createdAt = new Date().toISOString();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'go' }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: legacyAssistant('Part '),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: legacyAssistant('Part one'),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: legacyAssistant('Part one done'),
        created_at: createdAt,
      },
    ]);

    const counts = await dedupeStreamedAssistantRows(db);
    expect(counts.groupsCollapsed).toBe(1);
    expect(counts.rowsDeleted).toBe(2);

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
    expect(rows[1].type).toBe('assistant');
    expect(JSON.parse(rows[1].message_json)).toEqual({
      type: 'assistant',
      blocks: [{ type: 'text', text: 'Part one done' }],
    });
  });

  it('normalizes duplicate thinking blocks inside one row', () => {
    const row = {
      id: 99,
      type: 'assistant',
      message_json: JSON.stringify({
        type: 'assistant',
        blocks: [
          { type: 'thinking', thinking: 'a' },
          { type: 'thinking', thinking: 'ab' },
        ],
      }),
    };
    const plan = collapseStreamableAssistantRun([row]);
    expect(plan.deleteIds).toEqual([]);
    expect(JSON.parse(plan.message_json)).toEqual({
      type: 'assistant',
      blocks: [{ type: 'thinking', thinking: 'ab' }],
    });
  });

  it('collapseThinkingTokensRun keeps the latest estimate and strips uuid noise', () => {
    const rows = [
      {
        id: 1,
        type: 'system',
        subtype: 'thinking_tokens',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 10,
          estimated_tokens_delta: 10,
          uuid: 'old',
        }),
      },
      {
        id: 2,
        type: 'system',
        subtype: 'thinking_tokens',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 261,
          estimated_tokens_delta: 4,
          uuid: 'new',
        }),
      },
    ];
    expect(isThinkingTokensRow(rows[0])).toBe(true);
    const plan = collapseThinkingTokensRun(rows);
    expect(plan.keepId).toBe(2);
    expect(plan.deleteIds).toEqual([1]);
    expect(JSON.parse(plan.message_json)).toEqual({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 261,
      estimated_tokens_delta: 4,
    });
  });

  it('dedupeThinkingTokenRows collapses consecutive rows per session', async () => {
    const sessionId = await seedSession('tokens');
    const createdAt = new Date().toISOString();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'hi' }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'system',
        subtype: 'thinking_tokens',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 100,
          estimated_tokens_delta: 100,
        }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'system',
        subtype: 'thinking_tokens',
        message_json: JSON.stringify({
          type: 'system',
          subtype: 'thinking_tokens',
          estimated_tokens: 200,
          estimated_tokens_delta: 100,
        }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: legacyAssistant('answer'),
        created_at: createdAt,
      },
    ]);

    const counts = await dedupeThinkingTokenRows(db);
    expect(counts.groupsCollapsed).toBe(1);
    expect(counts.rowsDeleted).toBe(1);

    const rows = await db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(rows).toHaveLength(3);
    expect(rows[1].subtype).toBe('thinking_tokens');
    expect(JSON.parse(rows[1].message_json).estimated_tokens).toBe(200);
  });

  it('does not merge across tool_call rows', async () => {
    const sessionId = await seedSession('dedupe2');
    const createdAt = new Date().toISOString();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: legacyAssistant('Before'),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'tool_call',
        tool_call_id: 'tc1',
        message_json: JSON.stringify({
          type: 'tool_call',
          id: 'tc1',
          name: 'Bash',
          kind: 'bash',
          status: 'completed',
        }),
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        agent_type: 'builder',
        type: 'assistant',
        message_json: legacyAssistant('After'),
        created_at: createdAt,
      },
    ]);

    const counts = await dedupeStreamedAssistantRows(db);
    expect(counts.groupsCollapsed).toBe(2);
    expect(counts.rowsDeleted).toBe(0);
    const left = await db('session_messages').where({ session_id: sessionId }).orderBy('id', 'asc');
    expect(left).toHaveLength(3);
    expect(JSON.parse(left[0].message_json).blocks[0].text).toBe('Before');
    expect(JSON.parse(left[2].message_json).blocks[0].text).toBe('After');
  });
});
