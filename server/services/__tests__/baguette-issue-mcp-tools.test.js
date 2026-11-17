import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { buildSessionIssueReadTools } from '../mcp/registries/base_agent.js';
import {
  buildReviewerIssueMcpTools,
  buildSessionAgentIssueMcpTools,
} from '../baguette-issue-mcp-tools.js';
import { buildBuilderAgentTools } from '../mcp/registries/builder_agent.js';
import { SUBAGENT_EXCLUDED_MCP_TOOLS } from '../../../shared/session-scope.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';
import { registerAllSdkPlugins } from '../../agent-sdks/index.js';

registerAllSdkPlugins();

const db = createTestDb();

function parseOk(result) {
  return JSON.parse(result.content[0].text);
}

let app;
let session;

beforeEach(async () => {
  const [userId] = await db('users').insert({ github_id: 9, username: 'mcp', status: 'approved' });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: 'issmcp',
    initial_prompt: 't',
    base_branch: 'main',
    status: 'stopped',
    session_path: '/tmp/wt',
  });
  app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  useClaudeAgentStub(
    app,
    { onMessageCreated: async () => {}, syncSessionSettingsFromPatch: () => {} },
    ['onMessageCreated', 'syncSessionSettingsFromPatch']
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

  it('creates, lists, updates, and closes issues', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const create = tools.find((t) => t.name === 'CreateIssue');
    const list = tools.find((t) => t.name === 'ListIssues');
    const read = tools.find((t) => t.name === 'ReadIssue');
    const update = tools.find((t) => t.name === 'UpdateIssue');
    const close = tools.find((t) => t.name === 'CloseIssue');
    const sessionId = session.id;

    const created = parseOk(
      await create.handler({ severity: 'high', title: 'Leak', description: 'in foo.js' })
    );
    expect(created.ok).toBe(true);
    expect(created.issue.status).toBe('opened');
    expect(created.issue.agent_sdk).toBe(null);
    expect(created.issue.ref).toBe(1);
    const ref = created.issue.ref;

    const listed = parseOk(await list.handler({ session_id: sessionId }));
    expect(listed.count).toBe(1);
    expect(listed.issues[0].ref).toBe(1);

    const openedOnly = parseOk(await list.handler({ session_id: sessionId, status: 'opened' }));
    expect(openedOnly.count).toBe(1);

    const submitted = parseOk(
      await update.handler({ session_id: sessionId, ref, status: 'submitted' })
    );
    expect(submitted.issue.status).toBe('submitted');
    const submittedOnly = parseOk(
      await list.handler({ session_id: sessionId, status: 'submitted' })
    );
    expect(submittedOnly.count).toBe(1);

    const one = parseOk(await read.handler({ session_id: sessionId, ref }));
    expect(one.issue.title).toBe('Leak');

    const updated = parseOk(
      await update.handler({ session_id: sessionId, ref, status: 'resolved' })
    );
    expect(updated.issue.status).toBe('resolved');

    const closed = parseOk(await close.handler({ session_id: sessionId, ref }));
    expect(closed.ok).toBe(true);
    expect(closed.closed.status).toBe('closed');
    const after = parseOk(await list.handler({ session_id: sessionId }));
    expect(after.count).toBe(0);
    const missing = parseOk(await read.handler({ session_id: sessionId, ref }));
    expect(missing.ok).toBe(false);
  });

  it('requires session_id for ListIssues', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const list = tools.find((t) => t.name === 'ListIssues');
    const result = parseOk(await list.handler({}));
    expect(result.ok).toBe(false);
  });

  it('snapshots turn agent metadata injected into MCP tools on create', async () => {
    const tools = buildReviewerIssueMcpTools(session, app, {
      agent_sdk: 'cursor',
      model: 'composer',
      model_params: JSON.stringify([{ id: 'fast', value: 'true' }]),
    });
    const create = tools.find((t) => t.name === 'CreateIssue');
    const created = parseOk(
      await create.handler({ severity: 'low', title: 'Style', description: 'nit' })
    );
    expect(created.issue.agent_sdk).toBe('cursor');
    expect(created.issue.model).toBe('composer');
    expect(created.issue.model_params).toBe(JSON.stringify([{ id: 'fast', value: 'true' }]));
  });

  const decisionOptions = [
    { id: 'keep', title: 'Keep the API', description: 'No client break' },
    { id: 'rename', title: 'Rename the field', description: 'Clients must migrate' },
  ];

  it('creates and updates a needs_decision issue from options', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const create = tools.find((t) => t.name === 'CreateIssue');
    const update = tools.find((t) => t.name === 'UpdateIssue');
    const read = tools.find((t) => t.name === 'ReadIssue');
    const list = tools.find((t) => t.name === 'ListIssues');
    expect(update.schema.status.safeParse('needs_decision').success).toBe(true);

    const created = parseOk(
      await create.handler({
        severity: 'high',
        title: 'Breaking change',
        description: 'in api.js',
        options: decisionOptions,
      })
    );
    expect(created.ok).toBe(true);
    expect(created.issue.status).toBe('needs_decision');
    expect(created.issue.options).toEqual(decisionOptions);
    expect(created.issue.selected_option_id).toBeNull();

    const listed = parseOk(
      await list.handler({ session_id: session.id, status: 'needs_decision' })
    );
    expect(listed.count).toBe(1);
    expect(listed.issues[0].options).toEqual(decisionOptions);
    expect(listed.issues[0].selected_option_id).toBeNull();

    const cleared = parseOk(
      await update.handler({
        session_id: session.id,
        ref: created.issue.ref,
        options: [],
        status: 'opened',
      })
    );
    expect(cleared.issue.status).toBe('opened');
    expect(cleared.issue.options).toBeNull();

    const again = parseOk(
      await update.handler({
        session_id: session.id,
        ref: created.issue.ref,
        options: decisionOptions,
      })
    );
    expect(again.issue.status).toBe('needs_decision');

    const one = parseOk(await read.handler({ session_id: session.id, ref: created.issue.ref }));
    expect(one.issue.options).toEqual(decisionOptions);
    expect(one.issue.selected_option_id).toBeNull();
  });

  it('does not let UpdateIssue dismiss a pending decision', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const created = parseOk(
      await tools
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'high',
          title: 'Breaking change',
          options: decisionOptions,
        })
    );
    const updated = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssue')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          status: 'opened',
        })
    );
    expect(updated.ok).toBe(true);
    expect(updated.issue.status).toBe('needs_decision');
    expect(updated.issue.selected_option_id).toBeNull();
  });

  it('CloseIssue archives a needs_decision issue', async () => {
    const tools = buildReviewerIssueMcpTools(session, app);
    const created = parseOk(
      await tools
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'high',
          title: 'Duplicate choice',
          options: decisionOptions,
        })
    );
    expect(created.issue.status).toBe('needs_decision');
    const closed = parseOk(
      await tools
        .find((t) => t.name === 'CloseIssue')
        .handler({ session_id: session.id, ref: created.issue.ref })
    );
    expect(closed.ok).toBe(true);
    expect(closed.closed.status).toBe('closed');
    const listed = parseOk(
      await tools.find((t) => t.name === 'ListIssues').handler({ session_id: session.id })
    );
    expect(listed.count).toBe(0);
    const missing = parseOk(
      await tools
        .find((t) => t.name === 'ReadIssue')
        .handler({ session_id: session.id, ref: created.issue.ref })
    );
    expect(missing.ok).toBe(false);
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
    const tools = [
      ...buildSessionIssueReadTools(session, app),
      ...buildSessionAgentIssueMcpTools(session, app),
    ];
    expect(tools.map((t) => t.name).sort()).toEqual([
      'CreateIssue',
      'ListIssues',
      'ReadIssue',
      'UpdateIssue',
      'UpdateIssueStatus',
    ]);
    const updateIssue = tools.find((t) => t.name === 'UpdateIssue');
    expect(updateIssue.schema.status).toBeUndefined();
    expect(updateIssue.description).toMatch(/Does not change status/);

    const listed = parseOk(
      await tools
        .find((t) => t.name === 'ListIssues')
        .handler({ session_id: session.id, status: 'opened' })
    );
    expect(listed.count).toBe(1);

    const resolved = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssueStatus')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          status: 'resolved',
        })
    );
    expect(resolved.issue.status).toBe('resolved');

    const bad = JSON.parse(
      (
        await tools
          .find((t) => t.name === 'UpdateIssueStatus')
          .handler({
            session_id: session.id,
            ref: created.issue.ref,
            status: 'opened',
          })
      ).content[0].text
    );
    expect(bad.ok).toBe(false);

    const needsDecision = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssueStatus')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          status: 'needs_decision',
        })
    );
    expect(needsDecision.ok).toBe(false);
  });

  it('rejects UpdateIssueStatus while the issue needs a decision', async () => {
    const tools = [
      ...buildSessionIssueReadTools(session, app),
      ...buildSessionAgentIssueMcpTools(session, app),
    ];
    const created = parseOk(
      await tools
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'high',
          title: 'Pick one',
          options: [
            { id: 'a', title: 'Approach A', description: 'Smaller diff' },
            { id: 'b', title: 'Approach B', description: 'Cleaner API' },
          ],
        })
    );
    expect(created.issue.status).toBe('needs_decision');
    const rejected = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssueStatus')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          status: 'resolved',
        })
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/need a decision|choose an option/);
  });

  it('builder UpdateIssue ignores status and can attach options', async () => {
    const reviewer = buildReviewerIssueMcpTools(session, app);
    const created = parseOk(
      await reviewer
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'low',
          title: 'Tradeoff',
        })
    );
    const tools = buildSessionAgentIssueMcpTools(session, app);
    const renamed = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssue')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          status: 'ignored',
          title: 'Tradeoff renamed',
        })
    );
    expect(renamed.ok).toBe(true);
    expect(renamed.issue.title).toBe('Tradeoff renamed');
    expect(renamed.issue.status).toBe('opened');

    const updated = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssue')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          status: 'ignored',
          options: [
            { id: 'a', title: 'Approach A', description: 'Smaller diff' },
            { id: 'b', title: 'Approach B', description: 'Cleaner API' },
          ],
        })
    );
    expect(updated.ok).toBe(true);
    expect(updated.issue.status).toBe('needs_decision');
    expect(updated.issue.options).toHaveLength(2);
    expect(updated.issue.selected_option_id).toBeNull();
  });

  it('builder UpdateIssue with empty options reopens a needs_decision issue', async () => {
    const tools = buildSessionAgentIssueMcpTools(session, app);
    const created = parseOk(
      await tools
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'high',
          title: 'Pick one',
          options: [
            { id: 'a', title: 'Approach A', description: 'Smaller diff' },
            { id: 'b', title: 'Approach B', description: 'Cleaner API' },
          ],
        })
    );
    expect(created.issue.status).toBe('needs_decision');

    const cleared = parseOk(
      await tools
        .find((t) => t.name === 'UpdateIssue')
        .handler({
          session_id: session.id,
          ref: created.issue.ref,
          options: [],
        })
    );
    expect(cleared.ok).toBe(true);
    expect(cleared.issue.status).toBe('opened');
    expect(cleared.issue.options).toBeNull();
    expect(cleared.issue.selected_option_id).toBeNull();
  });

  it('snapshots the calling builder on CreateIssue', async () => {
    const tools = buildBuilderAgentTools(session, app, {
      agent: {
        agent_sdk: 'cursor',
        model: 'composer',
        model_params: JSON.stringify([{ id: 'fast', value: 'true' }]),
      },
    });
    const created = parseOk(
      await tools
        .find((t) => t.name === 'CreateIssue')
        .handler({
          severity: 'medium',
          title: 'Out of scope',
        })
    );
    expect(created.issue.agent_sdk).toBe('cursor');
    expect(created.issue.model).toBe('composer');
    expect(created.issue.model_params).toBe(JSON.stringify([{ id: 'fast', value: 'true' }]));
  });

  it('keeps UpdateIssueStatus as the only issue tool hidden from subagents', () => {
    expect(SUBAGENT_EXCLUDED_MCP_TOOLS).toContain('UpdateIssueStatus');
    expect(SUBAGENT_EXCLUDED_MCP_TOOLS).not.toContain('CreateIssue');
    expect(SUBAGENT_EXCLUDED_MCP_TOOLS).not.toContain('UpdateIssue');
  });
});
