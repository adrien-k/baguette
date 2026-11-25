/**
 * ArchiveSlackThread: archives what a Slack global session spawned, then the session itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { createArchiveSlackThreadTool } from '../mcp/tools/archive-slack-thread.js';
import {
  insertGlobalSession,
  insertSession,
  insertSlackApp,
  insertUser,
} from './slack-test-helpers.js';

const db = createTestDb();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function world() {
  const userId = await insertUser(db);
  const appId = await insertSlackApp(db);
  const sessionId = await insertGlobalSession(db, userId, appId);
  const archive = vi.fn(async (id) => {
    await db('sessions').where({ id }).update({ archived_at: new Date().toISOString() });
  });
  const app = { get: () => db, service: () => ({ archive }) };
  const session = await db('sessions').where({ id: sessionId }).first();
  const tool = createArchiveSlackThreadTool({ app, session });
  const call = async (args = { confirmed_by_owner: true }) =>
    JSON.parse((await tool.handler(args)).content[0].text);
  return { userId, appId, sessionId, archive, call };
}

describe('ArchiveSlackThread', () => {
  it('refuses until the owner has confirmed', async () => {
    const w = await world();
    expect(await w.call({ confirmed_by_owner: false })).toMatchObject({ ok: false });
    expect(w.archive).not.toHaveBeenCalled();
  });

  it('archives the children and grandchildren first, then itself after a moment', async () => {
    const w = await world();
    const child = await insertSession(db, w.userId, { parent_session_id: w.sessionId });
    const grandchild = await insertSession(db, w.userId, { parent_session_id: child });
    const other = await insertSession(db, w.userId);

    const out = await w.call();

    expect(out).toMatchObject({ ok: true, archived_sessions: [grandchild, child] });
    expect(w.archive.mock.calls.map(([id]) => id)).toEqual([grandchild, child]);
    expect(w.archive.mock.calls[0][1]).toEqual({ provider: undefined, user: { id: w.userId } });

    await vi.advanceTimersByTimeAsync(2000);
    expect(w.archive.mock.calls.map(([id]) => id)).toEqual([grandchild, child, w.sessionId]);
    expect(w.archive).not.toHaveBeenCalledWith(other, expect.anything());
  });

  it('leaves already archived sessions and other owners’ sessions alone', async () => {
    const w = await world();
    const done = await insertSession(db, w.userId, {
      parent_session_id: w.sessionId,
      archived_at: new Date().toISOString(),
    });
    const strangerId = await insertUser(db);
    const foreign = await insertSession(db, strangerId, { parent_session_id: w.sessionId });

    const out = await w.call();

    expect(out.archived_sessions).toEqual([]);
    expect(w.archive).not.toHaveBeenCalledWith(done, expect.anything());
    expect(w.archive).not.toHaveBeenCalledWith(foreign, expect.anything());
  });

  it('keeps itself alive and reports it when a child cannot be archived', async () => {
    const w = await world();
    const child = await insertSession(db, w.userId, { parent_session_id: w.sessionId });
    w.archive.mockRejectedValueOnce(new Error('cleanup failed'));

    const out = await w.call();

    expect(out.ok).toBe(false);
    expect(out.error).toContain(`"session_id":${child}`);
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.archive).not.toHaveBeenCalledWith(w.sessionId, expect.anything());
  });

  it('is for Slack global sessions only', async () => {
    const userId = await insertUser(db);
    const plain = await insertSession(db, userId);
    const session = await db('sessions').where({ id: plain }).first();
    const tool = createArchiveSlackThreadTool({ app: { get: () => db }, session });
    const out = JSON.parse((await tool.handler({ confirmed_by_owner: true })).content[0].text);
    expect(out.ok).toBe(false);
  });
});
