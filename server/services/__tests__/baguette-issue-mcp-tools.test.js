import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import {
  buildReviewerIssueMcpTools,
  buildSessionAgentIssueMcpTools,
} from '../baguette-issue-mcp-tools.js';

const db = createTestDb({ beforeEach, afterEach });

function parseOk(result) {
  return JSON.parse(result.content[0].text);
}

let app;
let session;

beforeEach(async () => {
  const [userId] = await db('users').insert({ github_id: 9, username: 'mcp', approved: true });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', bare_path: '/tmp/r' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: 'issmcp',
    initial_prompt: 't',
    base_branch: 'main',
    status: 'stopped',
    worktree_path: '/tmp/wt',
  });
  app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  app.use(
    'claude-agent',
    { onMessageCreated: async () => {}, syncSessionSettingsFromPatch: () => {} },
    { methods: ['onMessageCreated', 'syncSessionSettingsFromPatch'] }
  );
  registerMessagesService(app);
  registerSessionIssuesService(app);
  await app.setup();
  session = await db('sessions').where({ id: sessionId }).first();
});

describe('reviewer issue MCP tools', () => {
  it('exposes CurrentSessionInfo with read-only worktree rules', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const infoTool = tools.find((t) => t.name === 'CurrentSessionInfo');
    expect(infoTool).toBeTruthy();
    const info = parseOk(await infoTool.handler({}));
    expect(info.ok).toBe(true);
    expect(info.base_branch).toBe('main');
    expect(info.working_directory_restrictions).toContain('read-only');
  });

  it('re-reads the session row so branch names stay current', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const infoTool = tools.find((t) => t.name === 'CurrentSessionInfo');
    await db('sessions').where({ id: session.id }).update({
      local_branch: 'feat/new',
      remote_branch: 'feat/new',
    });
    const info = parseOk(await infoTool.handler({}));
    expect(info.remote_branch).toBe('feat/new');
    expect(info.local_branch).toBe('feat/new');
  });

  it('creates, lists, updates, and deletes issues', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const create = tools.find((t) => t.name === 'CreateIssue');
    const list = tools.find((t) => t.name === 'ListIssues');
    const read = tools.find((t) => t.name === 'ReadIssue');
    const update = tools.find((t) => t.name === 'UpdateIssue');
    const del = tools.find((t) => t.name === 'DeleteIssue');

    const created = parseOk(
      await create.handler({ severity: 'high', title: 'Leak', description: 'in foo.js' })
    );
    expect(created.ok).toBe(true);
    expect(created.issue.status).toBe('opened');
    const id = created.issue.id;

    const listed = parseOk(await list.handler({}));
    expect(listed.count).toBe(1);

    const openedOnly = parseOk(await list.handler({ status: 'opened' }));
    expect(openedOnly.count).toBe(1);

    const submitted = parseOk(await update.handler({ issue_id: id, status: 'submitted' }));
    expect(submitted.issue.status).toBe('submitted');
    const submittedOnly = parseOk(await list.handler({ status: 'submitted' }));
    expect(submittedOnly.count).toBe(1);

    const one = parseOk(await read.handler({ issue_id: id }));
    expect(one.issue.title).toBe('Leak');

    const updated = parseOk(await update.handler({ issue_id: id, status: 'resolved' }));
    expect(updated.issue.status).toBe('resolved');

    const deleted = parseOk(await del.handler({ issue_id: id }));
    expect(deleted.ok).toBe(true);
    const after = parseOk(await list.handler({}));
    expect(after.count).toBe(0);
  });
});

describe('session agent issue MCP tools', () => {
  it('reads and updates status to ignored or resolved', async () => {
    const reviewer = buildReviewerIssueMcpTools(session, app);
    const created = parseOk(
      await reviewer
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'medium',
          title: 'N+1',
        })
    );
    const tools = buildSessionAgentIssueMcpTools(session, app);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'ListIssues',
      'ReadIssue',
      'UpdateIssueStatus',
    ]);

    const listed = parseOk(
      await tools.find((t) => t.name === 'ListIssues').handler({ status: 'opened' })
    );
    expect(listed.count).toBe(1);

    const resolved = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssueStatus')
        .handler({
          issue_id: created.issue.id,
          status: 'resolved',
        })
    );
    expect(resolved.issue.status).toBe('resolved');

    const bad = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssueStatus')
        .handler({
          issue_id: created.issue.id,
          status: 'opened',
        })
    );
    expect(bad.ok).toBe(false);
  });
});
