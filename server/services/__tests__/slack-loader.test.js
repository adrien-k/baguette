/**
 * The "🥖 Baguette is cooking…" message in a Slack thread.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const slack = vi.hoisted(() => ({
  postMessage: vi.fn(),
  deleteMessage: vi.fn(),
  updateMessage: vi.fn(),
  setAgentSessionStatus: vi.fn(),
  setThreadStatus: vi.fn(),
}));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

import { createSlackLoader, formatElapsed, loaderText, toolDisplayName } from '../slack-loader.js';
import {
  decryptedApp,
  insertSession,
  insertSlackApp,
  insertThread,
  insertUser,
  slackTestApp,
} from './slack-test-helpers.js';

const db = createTestDb();

async function setup({ sessionStatus = 'running', apps, clock } = {}) {
  const userId = await insertUser(db);
  const appId = await insertSlackApp(db);
  const sessionId = await insertSession(db, userId, { status: sessionStatus });
  const threadId = await insertThread(db, {
    slack_app_id: appId,
    session_id: sessionId,
    user_id: userId,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  const loader = createSlackLoader({
    db: () => db,
    loadApps: async () => apps ?? [decryptedApp({ id: appId })],
    threads: () => slackTestApp(db).service('slack-threads'),
    ...(clock ? { now: clock.now } : {}),
  });
  return { userId, appId, sessionId, threadId, loader };
}

const postedTexts = () => slack.postMessage.mock.calls.map(([, args]) => args.text);

const statusTs = async (threadId) =>
  (await db('slack_threads').where({ id: threadId }).first()).status_ts;

beforeEach(() => {
  slack.postMessage.mockReset().mockResolvedValue({ channel: 'C1', ts: '20.1' });
  slack.deleteMessage.mockReset().mockResolvedValue(undefined);
  slack.updateMessage.mockReset().mockResolvedValue(undefined);
  // By default Slack refuses the native status (no `assistant:write`), so the message loader runs.
  const refused = () => Object.assign(new Error('missing_scope'), { slackError: 'missing_scope' });
  slack.setAgentSessionStatus.mockReset().mockRejectedValue(refused());
  slack.setThreadStatus.mockReset().mockRejectedValue(refused());
});

describe('syncLoaders', () => {
  it('shows the loader in the thread while the agent runs — and only once', async () => {
    const { loader, threadId } = await setup();
    await loader.syncLoaders();
    await loader.syncLoaders();

    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    expect(slack.postMessage).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      threadTs: '9.9',
      text: expect.stringContaining('cooking'),
    });
    expect(await statusTs(threadId)).toBe('20.1');
  });

  it('removes the loader when the agent stops (finished, or stopped in the UI)', async () => {
    const { loader, threadId, sessionId } = await setup();
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'stopped' });
    await loader.syncLoaders();

    expect(slack.deleteMessage).toHaveBeenCalledWith('xoxb-test', { channel: 'C1', ts: '20.1' });
    expect(await statusTs(threadId)).toBeNull();
  });

  it('removes the loader when the session is archived', async () => {
    const { loader, threadId, sessionId } = await setup();
    await loader.syncLoaders();
    await db('sessions').where({ id: sessionId }).update({ archived_at: new Date().toISOString() });
    await loader.syncLoaders();
    expect(await statusTs(threadId)).toBeNull();
  });

  it('shows nothing for an idle session', async () => {
    const { loader } = await setup({ sessionStatus: 'stopped' });
    await loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('can be limited to one session', async () => {
    const { loader, sessionId } = await setup();
    await loader.syncLoaders(sessionId + 100);
    expect(slack.postMessage).not.toHaveBeenCalled();
    await loader.syncLoaders(sessionId);
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores threads older than a week when polling, but not when asked about the session', async () => {
    const { loader, threadId, sessionId } = await setup();
    await db('slack_threads').where({ id: threadId }).update({ created_at: '2020-01-01 00:00:00' });
    await loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();
    await loader.syncLoaders(sessionId);
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
  });

  it('only follows each thread’s newest session', async () => {
    const { loader, userId, appId } = await setup({ sessionStatus: 'stopped' });
    const oldRunning = await insertSession(db, userId, { status: 'running' });
    // Older binding of a still-running session…
    await insertThread(db, {
      slack_app_id: appId,
      session_id: oldRunning,
      user_id: userId,
      created_at: '2026-01-01 00:00:00',
    });
    // …superseded by a newer, idle one.
    const newer = await insertSession(db, userId, { status: 'stopped' });
    await insertThread(db, { slack_app_id: appId, session_id: newer, user_id: userId });
    await loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('skips threads whose Slack app is gone or has no token', async () => {
    const gone = await setup({ apps: [] });
    await gone.loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();

    const tokenless = await setup({ apps: [decryptedApp({ id: 999, bot_token: null })] });
    await tokenless.loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('keeps going when Slack fails, and retries next time', async () => {
    const { loader, threadId } = await setup();
    slack.postMessage.mockRejectedValueOnce(new Error('ratelimited'));
    await expect(loader.syncLoaders()).resolves.toBeUndefined();
    expect(await statusTs(threadId)).toBeNull();

    await loader.syncLoaders();
    expect(await statusTs(threadId)).toBe('20.1');
  });

  it('forgets the loader even if deleting the message fails', async () => {
    const { loader, threadId, sessionId } = await setup();
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'stopped' });
    slack.deleteMessage.mockRejectedValue(new Error('message_not_found'));
    await loader.syncLoaders();
    expect(await statusTs(threadId)).toBeNull();
  });
});

/** A clock the tests can move. */
const makeClock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
};

const threadRow = (threadId) => db('slack_threads').where({ id: threadId }).first();
const slackApp = () => decryptedApp({ id: 1 });

describe('loaderText', () => {
  it.each([
    [{ state: 'working', elapsedMs: 0 }, '🥖 Baguette is cooking…'],
    [{ state: 'provisioning', elapsedMs: 0 }, '🥖 Heating up the oven (setting up the workspace)…'],
    [{ elapsedMs: 5_000 }, '🥖 Baguette is cooking…'],
    [
      { state: 'working', activity: 'Bash', elapsedMs: 0 },
      '🥖 Baguette is cooking… · running Bash',
    ],
    [{ state: 'working', elapsedMs: 130_000 }, '🥖 Baguette is cooking… · 2m 10s'],
    [
      { state: 'working', activity: 'Edit', elapsedMs: 45_000 },
      '🥖 Baguette is cooking… · running Edit · 45s',
    ],
  ])('%j → %s', (input, expected) => {
    expect(loaderText(input)).toBe(expected);
  });

  it('formats elapsed time and tool names', () => {
    expect(formatElapsed(9_000)).toBe('9s');
    expect(formatElapsed(61_000)).toBe('1m 1s');
    expect(toolDisplayName('mcp__baguette__SearchSessions')).toBe('SearchSessions');
    expect(toolDisplayName('Bash')).toBe('Bash');
    expect(toolDisplayName(undefined)).toBe('');
  });
});

describe('showNow: the loader before the agent has started', () => {
  it('posts the loader at once, even though nothing is running yet', async () => {
    const { loader, threadId } = await setup({ sessionStatus: 'stopped' });
    await loader.showNow(await threadRow(threadId), slackApp());

    expect(postedTexts()).toEqual(['🥖 Baguette is cooking…']);
    expect((await threadRow(threadId)).status_ts).toBe('20.1');
  });

  it('keeps it up while the turn is about to start', async () => {
    const clock = makeClock();
    const { loader, threadId } = await setup({ sessionStatus: 'stopped', clock });
    await loader.showNow(await threadRow(threadId), slackApp());
    clock.advance(30_000);
    await loader.syncLoaders();
    expect(slack.deleteMessage).not.toHaveBeenCalled();
    expect((await threadRow(threadId)).status_ts).toBe('20.1');
  });

  it('removes it if the turn never starts', async () => {
    const clock = makeClock();
    const { loader, threadId } = await setup({ sessionStatus: 'stopped', clock });
    await loader.showNow(await threadRow(threadId), slackApp());
    clock.advance(91_000);
    await loader.syncLoaders();
    expect(slack.deleteMessage).toHaveBeenCalledTimes(1);
    expect((await threadRow(threadId)).status_ts).toBeNull();
  });

  it('removes it as soon as the turn is over, without waiting out the grace period', async () => {
    const { loader, threadId, sessionId } = await setup({ sessionStatus: 'stopped' });
    await loader.showNow(await threadRow(threadId), slackApp());
    await loader.syncLoaders(sessionId, { settled: true });
    expect(slack.deleteMessage).toHaveBeenCalledTimes(1);
    expect((await threadRow(threadId)).status_ts).toBeNull();
  });

  it('removes it once the turn that started has finished', async () => {
    const { loader, threadId, sessionId } = await setup({ sessionStatus: 'stopped' });
    await loader.showNow(await threadRow(threadId), slackApp());
    await db('agents').where({ session_id: sessionId }).update({ status: 'running' });
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'stopped' });
    await loader.syncLoaders();
    expect((await threadRow(threadId)).status_ts).toBeNull();
  });

  it('does not post a second loader when one is already up', async () => {
    const { loader, threadId } = await setup();
    await loader.syncLoaders();
    await loader.showNow(await threadRow(threadId), slackApp());
    await loader.showNow(await threadRow(threadId), slackApp());
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
  });

  it('survives Slack refusing the post', async () => {
    const { loader, threadId } = await setup({ sessionStatus: 'stopped' });
    slack.postMessage.mockRejectedValue(new Error('ratelimited'));
    await expect(loader.showNow(await threadRow(threadId), slackApp())).resolves.toBeUndefined();
    expect((await threadRow(threadId)).status_ts).toBeNull();
  });
});

describe('what the loader says', () => {
  it('says the workspace is being set up while the session provisions', async () => {
    const { loader } = await setup({ sessionStatus: 'provisioning' });
    await loader.syncLoaders();
    expect(postedTexts()).toEqual(['🥖 Heating up the oven (setting up the workspace)…']);
  });

  it('switches to "Working…" at once when provisioning is done', async () => {
    const { loader, sessionId, threadId } = await setup({ sessionStatus: 'provisioning' });
    await loader.syncLoaders();
    await db('sessions').where({ id: sessionId }).update({ status: 'stopped' });
    await db('agents').where({ session_id: sessionId }).update({ status: 'running' });
    await loader.syncLoaders();

    expect(slack.updateMessage).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      ts: '20.1',
      text: '🥖 Baguette is cooking…',
    });
    expect((await threadRow(threadId)).status_ts).toBe('20.1');
  });

  const toolCall = (sessionId, name, status) =>
    db('session_messages').insert({
      session_id: sessionId,
      agent_id: null,
      type: 'tool_call',
      message_json: JSON.stringify({ type: 'tool_call', name, status }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });

  it('names the tool the agent is running, and the time once it has been a while', async () => {
    const clock = makeClock();
    const { loader, sessionId } = await setup({ clock });
    await loader.syncLoaders();
    await toolCall(sessionId, 'mcp__baguette__RunTask', 'running');

    clock.advance(45_000);
    await loader.syncLoaders();
    expect(slack.updateMessage).toHaveBeenLastCalledWith('xoxb-test', {
      channel: 'C1',
      ts: '20.1',
      text: '🥖 Baguette is cooking… · running RunTask · 45s',
    });
  });

  it('drops the tool name once the call has completed', async () => {
    const clock = makeClock();
    const { loader, sessionId } = await setup({ clock });
    await loader.syncLoaders();
    await toolCall(sessionId, 'Bash', 'completed');
    clock.advance(40_000);
    await loader.syncLoaders();
    expect(slack.updateMessage).toHaveBeenLastCalledWith(
      'xoxb-test',
      expect.objectContaining({
        text: '🥖 Baguette is cooking… · 40s',
      })
    );
  });

  it('does not edit the message more often than every 20 seconds, nor when nothing changed', async () => {
    const clock = makeClock();
    const { loader } = await setup({ clock });
    await loader.syncLoaders();
    clock.advance(5_000);
    await loader.syncLoaders();
    clock.advance(5_000);
    await loader.syncLoaders();
    expect(slack.updateMessage).not.toHaveBeenCalled();

    clock.advance(25_000); // 35s: the elapsed time now shows
    await loader.syncLoaders();
    await loader.syncLoaders();
    expect(slack.updateMessage).toHaveBeenCalledTimes(1);
  });

  it('copes with an unreadable tool call row and a Slack that refuses edits', async () => {
    const clock = makeClock();
    const { loader, sessionId } = await setup({ clock });
    await loader.syncLoaders();
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: null,
      type: 'tool_call',
      message_json: 'not json',
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    slack.updateMessage.mockRejectedValue(new Error('message_not_found'));
    clock.advance(40_000);
    await expect(loader.syncLoaders()).resolves.toBeUndefined();
  });
});

describe('native Slack status', () => {
  beforeEach(() => {
    slack.setAgentSessionStatus.mockReset().mockResolvedValue(undefined);
    slack.setThreadStatus.mockReset().mockResolvedValue(undefined);
  });

  const lines = () => slack.setThreadStatus.mock.calls.map(([, args]) => args.status);

  const statuses = () => slack.setAgentSessionStatus.mock.calls.map(([, args]) => args.status);

  it('marks the thread processing instead of posting a message', async () => {
    const { loader, threadId } = await setup();
    await loader.syncLoaders();

    expect(slack.setAgentSessionStatus).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      threadTs: '9.9',
      status: 'processing',
    });
    expect(slack.postMessage).not.toHaveBeenCalled();
    expect(await statusTs(threadId)).toBeNull();
  });

  it('shows the animated “Baguette is cooking…” line under the thread', async () => {
    const { loader } = await setup();
    await loader.syncLoaders();
    expect(slack.setThreadStatus).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      threadTs: '9.9',
      status: 'is cooking… 🥖',
    });
  });

  it('updates the line with the tool and the time as the turn goes on', async () => {
    const clock = { t: 1_000_000, now: () => clock.t };
    const { loader } = await setup({ clock });
    await loader.syncLoaders();
    clock.t += 45_000;
    await loader.syncLoaders();
    expect(lines()).toEqual(['is cooking… 🥖', 'is cooking… 🥖 · 45s']);
  });

  it('says when the workspace is being set up', async () => {
    const { loader } = await setup({ sessionStatus: 'provisioning' });
    await loader.syncLoaders();
    expect(lines()).toEqual(['is heating up the oven (setting up the workspace)…']);
  });

  it('works with just the agent state when the text line is refused (and the other way round)', async () => {
    slack.setThreadStatus.mockRejectedValue(new Error('missing_scope'));
    const a = await setup();
    await a.loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();

    slack.setThreadStatus.mockResolvedValue(undefined);
    slack.setAgentSessionStatus.mockRejectedValue(new Error('feature_disabled'));
    const b = await setup();
    await b.loader.syncLoaders();
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('clears the line when the agent stops', async () => {
    const { loader, sessionId } = await setup();
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'stopped' });
    await loader.syncLoaders();
    expect(lines().at(-1)).toBe('');
  });

  it('sets it once, not on every sync', async () => {
    const { loader } = await setup();
    await loader.syncLoaders();
    await loader.syncLoaders();
    expect(statuses()).toEqual(['processing']);
  });

  it('sets it again after a minute, in case Slack let it lapse', async () => {
    const clock = { t: 1_000_000, now: () => clock.t };
    const { loader } = await setup({ clock });
    await loader.syncLoaders();
    clock.t += 61_000;
    await loader.syncLoaders();
    expect(statuses()).toEqual(['processing', 'processing']);
  });

  it('puts it back to active when the agent stops', async () => {
    const { loader, sessionId } = await setup();
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'stopped' });
    await loader.syncLoaders();
    await loader.syncLoaders();
    expect(statuses()).toEqual(['processing', 'active']); // and not again
  });

  it('shows it at once for a message about to reach the session', async () => {
    const { loader, appId, threadId } = await setup({ sessionStatus: 'stopped' });
    const thread = await db('slack_threads').where({ id: threadId }).first();
    await loader.showNow(thread, decryptedApp({ id: appId }));
    await loader.showNow(thread, decryptedApp({ id: appId }));

    expect(statuses()).toEqual(['processing']);
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('falls back to the message loader when Slack refuses, and stops asking for a while', async () => {
    const clock = { t: 1_000_000, now: () => clock.t };
    const first = await setup({ clock });
    slack.setAgentSessionStatus.mockRejectedValueOnce(new Error('feature_disabled'));
    slack.setThreadStatus.mockRejectedValueOnce(new Error('missing_scope'));
    await first.loader.syncLoaders();
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    expect(await statusTs(first.threadId)).toBe('20.1');

    // Another thread on the same app: Slack is not asked again within the block window.
    await insertThread(db, {
      slack_app_id: first.appId,
      session_id: first.sessionId,
      user_id: first.userId,
      channel_id: 'C2',
      thread_ts: '8.8',
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    await first.loader.syncLoaders();
    expect(slack.setAgentSessionStatus).toHaveBeenCalledTimes(1);
    expect(slack.setThreadStatus).toHaveBeenCalledTimes(1);
    expect(slack.postMessage).toHaveBeenCalledTimes(2);
  });

  it('uses the native status again once the block has passed', async () => {
    const clock = { t: 1_000_000, now: () => clock.t };
    slack.setAgentSessionStatus.mockRejectedValueOnce(new Error('feature_disabled'));
    slack.setThreadStatus.mockRejectedValueOnce(new Error('missing_scope'));
    const { loader, sessionId } = await setup({ clock });
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'stopped' });
    await loader.syncLoaders();
    await db('agents').where({ session_id: sessionId }).update({ status: 'running' });
    clock.t += 6 * 60_000;
    await loader.syncLoaders();
    expect(statuses()).toEqual(['processing', 'processing']);
  });
});
