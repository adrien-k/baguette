import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerAgentsService(app);
  useClaudeAgentStub(
    app,
    {
      onMessageCreated: async () => {},
      syncSessionSettingsFromPatch: () => {},
    },
    ['onMessageCreated', 'syncSessionSettingsFromPatch']
  );
  registerMessagesService(app);
  registerSessionIssuesService(app);
  return app;
}

let app;
let user;
let other;
let sessionId;

beforeEach(async () => {
  await db('users').insert([
    { github_id: 1, username: 'alice', approved: true },
    { github_id: 2, username: 'bob', approved: true },
  ]);
  user = await db('users').where({ username: 'alice' }).first();
  other = await db('users').where({ username: 'bob' }).first();
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertTestSession(db, {
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    base_branch: 'main',
    initial_prompt: 't',
    short_id: 'reviss',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_sdk: 'claude',
    model: 'sonnet',
  });
  app = makeApp(db);
  await app.setup();
});

describe('session-issues service', () => {
  it('creates internally and lists for the owner', async () => {
    const created = await app.service('session-issues').create(
      {
        session_id: sessionId,
        severity: 'high',
        title: 'Bug',
        description: 'Details',
      },
      { user }
    );
    expect(created.status).toBe('opened');
    const found = await app.service('session-issues').find(params(user));
    const rows = found.data ?? found;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Bug');
  });

  it('rejects external create', async () => {
    await expect(
      app
        .service('session-issues')
        .create({ session_id: sessionId, severity: 'low', title: 'Nope' }, params(user))
    ).rejects.toThrow('created by the reviewer');
  });

  it('lets the owner ignore via patch', async () => {
    const created = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'medium', title: 'Nit' }, { user });
    const patched = await app
      .service('session-issues')
      .patch(created.id, { status: 'ignored' }, params(user));
    expect(patched.status).toBe('ignored');
  });

  it('lets the owner mark an issue submitted', async () => {
    const created = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'high', title: 'Bug' }, { user });
    const patched = await app
      .service('session-issues')
      .patch(created.id, { status: 'submitted' }, params(user));
    expect(patched.status).toBe('submitted');
  });

  it('does not leak other users issues', async () => {
    await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'low', title: 'Mine' }, { user });
    const found = await app.service('session-issues').find(params(other));
    const rows = found.data ?? found;
    expect(rows).toHaveLength(0);
  });

  it('hides closed issues from the default list', async () => {
    const created = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'low', title: 'Gone' }, { user });
    await app.service('session-issues').patch(created.id, { status: 'closed' }, params(user));
    const found = await app.service('session-issues').find(params(user));
    const rows = found.data ?? found;
    expect(rows).toHaveLength(0);
    const closedOnly = await app
      .service('session-issues')
      .find({ ...params(user), query: { status: 'closed' } });
    const closedRows = closedOnly.data ?? closedOnly;
    expect(closedRows).toHaveLength(1);
    expect(closedRows[0].id).toBe(created.id);
  });

  it('lets the owner edit title, description, and severity', async () => {
    const created = await app
      .service('session-issues')
      .create(
        { session_id: sessionId, severity: 'low', title: 'Before', description: 'Old' },
        { user }
      );
    const patched = await app.service('session-issues').patch(
      created.id,
      {
        title: 'After',
        description: 'New details',
        severity: 'critical',
      },
      params(user)
    );
    expect(patched.title).toBe('After');
    expect(patched.description).toBe('New details');
    expect(patched.severity).toBe('critical');
  });

  it('rejects empty title on patch', async () => {
    const created = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'low', title: 'X' }, { user });
    await expect(
      app.service('session-issues').patch(created.id, { title: '   ' }, params(user))
    ).rejects.toThrow('title is required');
  });

  it('rejects invalid status', async () => {
    const created = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'low', title: 'X' }, { user });
    await expect(
      app.service('session-issues').patch(created.id, { status: 'done' }, params(user))
    ).rejects.toThrow('Invalid issue status');
  });

  it('askAgentToFix posts a builder message then marks the issue submitted', async () => {
    const created = await app.service('session-issues').create(
      {
        session_id: sessionId,
        severity: 'high',
        title: 'Sensitive title',
        description: 'Sensitive description',
      },
      { user }
    );
    const result = await app.service('session-issues').askAgentToFix(created.id, params(user));
    expect(result.ok).toBe(true);
    expect(result.issue.status).toBe('submitted');

    const messages = await app.service('messages').find({
      ...params(user),
      query: { session_id: sessionId, $sort: { id: 1 } },
      paginate: false,
    });
    const rows = Array.isArray(messages) ? messages : messages.data;
    expect(rows).toHaveLength(1);
    const parsed = JSON.parse(rows[0].message_json);
    const content = parsed.content ?? parsed.message?.content ?? '';
    expect(content).toContain('ReadIssue');
    expect(content).not.toContain('Sensitive title');
    expect(content).not.toContain('Sensitive description');
  });

  it('askAgentToFixAll posts one message then submits every opened issue', async () => {
    const a = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'low', title: 'A' }, { user });
    const b = await app
      .service('session-issues')
      .create({ session_id: sessionId, severity: 'medium', title: 'B' }, { user });
    const result = await app
      .service('session-issues')
      .askAgentToFixAll({ session_id: sessionId }, params(user));
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(result.issues.every((i) => i.status === 'submitted')).toBe(true);

    const messages = await app.service('messages').find({
      ...params(user),
      query: { session_id: sessionId },
      paginate: false,
    });
    const rows = Array.isArray(messages) ? messages : messages.data;
    expect(rows).toHaveLength(1);
  });
});
