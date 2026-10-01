import { describe, it, expect, vi, beforeEach } from 'vitest';

// Override global setup.js mock for claude-agent-sdk so tool() and createSdkMcpServer work
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const tool = (name, description, inputSchema, handler) => ({
    name,
    description,
    inputSchema,
    handler,
  });
  const createSdkMcpServer = vi.fn((opts) => ({ name: opts.name, tools: opts.tools }));
  return { tool, createSdkMcpServer };
});

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

vi.mock('../github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    gitPull: vi.fn(),
    gitPush: vi.fn(),
    gitFetch: vi.fn(),
    upsertPR: vi.fn(),
    getOpenPR: vi.fn().mockResolvedValue(null),
    getOpenPRByNumber: vi.fn().mockResolvedValue({ title: 'PR title', body: 'PR body' }),
    getPRComments: vi.fn(),
    createPRComment: vi.fn(),
    createPRLineComment: vi.fn(),
    createPRReview: vi.fn(),
    getPRWorkflows: vi.fn(),
    getPRWorkflowLogs: vi.fn(),
  };
});

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadBaguetteConfig: vi.fn().mockResolvedValue(null) };
});

vi.mock('../agent-settings.js', () => ({ getGithubToken: vi.fn(() => 'ghtoken') }));
vi.mock('../logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});
vi.mock('../prompts/loadPrompt.js', () => ({ default: vi.fn().mockResolvedValue('prompt text') }));
vi.mock('../port-utils.js', () => ({ isPortListening: vi.fn().mockResolvedValue(false) }));

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'child_process';
import {
  gitPull,
  gitPush,
  gitFetch,
  upsertPR,
  getOpenPR,
  getOpenPRByNumber,
  getPRComments,
  createPRComment,
  createPRLineComment,
  createPRReview,
  getPRWorkflows,
  getPRWorkflowLogs,
  BAGUETTE_DESCRIPTION_MARKER,
} from '../github.js';
import { loadBaguetteConfig } from '../baguette-config.js';
import { isPortListening } from '../port-utils.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

const DEFAULT_SESSION = {
  id: 1,
  short_id: 'test',
  user_id: 1,
  repo_id: 7,
  pr_url: null,
  pr_number: null,
  remote_branch: null,
  local_branch: null,
  repo_full_name: 'owner/repo',
  base_branch: 'main',
  worktree_path: '/tmp/wt',
  auto_push: 1,
};
const SESSION_HEADER = '*Posted by baguette - Claude, session test:*\n\n';
const INTERNAL_PATCH_PARAMS = { provider: undefined, user: { id: 1 } };

/** Simulates a task that calls onLog/onExit callbacks asynchronously. */
function makeTaskCreate({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  return vi.fn().mockImplementation((data) => {
    // Mirrors TasksService.create(), which defaults the label to the task key.
    const task = { id: 99, label: data.label ?? data.task_key ?? null, status: 'running' };
    setImmediate(() => {
      if (stdout) data.onLog?.(task.id, 'stdout', stdout);
      if (stderr) data.onLog?.(task.id, 'stderr', stderr);
      setImmediate(() => data.onExit?.(task.id, exitCode));
    });
    return Promise.resolve(task);
  });
}

function makeApp(
  sessionData,
  { tasksCreate, tasksGetTask, tasksFilterTasks, usageRows = [] } = {}
) {
  let sessionSnapshot = {
    ...DEFAULT_SESSION,
    ...sessionData,
    user_id: sessionData.user_id ?? DEFAULT_SESSION.user_id,
  };
  const mockPatch = vi.fn().mockImplementation(async (id, data) => {
    sessionSnapshot = { ...sessionSnapshot, ...data, id };
    return sessionSnapshot;
  });
  const mockGetTaskEnv = vi.fn().mockResolvedValue({});
  const mockCreate = tasksCreate ?? vi.fn().mockResolvedValue({ id: 99 });
  const mockGetTask = tasksGetTask ?? vi.fn().mockReturnValue(null);
  const mockFilterTasks = tasksFilterTasks ?? vi.fn().mockReturnValue([]);
  const emptyUsageQuery = () => {
    const chain = {
      where: () => chain,
      select: () => chain,
      sum: () => chain,
      groupByRaw: () => chain,
      orderBy: () => chain,
      then(onFulfilled, onRejected) {
        return Promise.resolve(usageRows).then(onFulfilled, onRejected);
      },
    };
    return chain;
  };
  const db = (table) => {
    if (table === 'sessions')
      return { where: () => ({ first: async () => ({ ...sessionSnapshot }) }) };
    if (table === 'users')
      return { where: () => ({ first: async () => ({ id: 1, access_token: 'tok' }) }) };
    if (table === 'repos')
      return {
        where: () => ({
          first: async () => ({
            id: sessionSnapshot.repo_id ?? 7,
            full_name: sessionSnapshot.repo_full_name ?? 'owner/repo',
            default_branch: 'main',
          }),
        }),
      };
    if (table === 'usage') return emptyUsageQuery();
    return { where: () => ({ first: async () => null }) };
  };
  db.raw = (sql) => sql;
  const app = {
    get: (key) => (key === 'db' ? db : null),
    service: (name) => {
      if (name === 'users') return { get: async () => ({ id: 1, access_token: 'tok' }) };
      if (name === 'tasks')
        return { getTask: mockGetTask, filterTasks: mockFilterTasks, create: mockCreate };
      return { patch: mockPatch, getTaskEnv: mockGetTaskEnv, create: mockCreate };
    },
  };
  return { app, mockPatch, mockGetTaskEnv, mockCreate, mockGetTask, mockFilterTasks };
}

async function buildServer(sessionOverrides = {}, appOpts = {}) {
  const sessionRow = { ...DEFAULT_SESSION, ...sessionOverrides };
  const { app, mockPatch, mockGetTaskEnv, mockCreate, mockGetTask, mockFilterTasks } = makeApp(
    sessionRow,
    appOpts
  );
  await buildBaguetteMcpServer(sessionRow, app);
  const tools = createSdkMcpServer.mock.calls[0][0].tools;
  return { tools, mockPatch, mockGetTaskEnv, mockCreate, mockGetTask, mockFilterTasks };
}

function callTool(tools, name, args = {}) {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool '${name}' not found`);
  return t.handler(args, null);
}

function parseResult(res) {
  return JSON.parse(res.content[0].text);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('global sessions', () => {
  it('omits git and PR tools', async () => {
    const { tools } = await buildServer({ is_global: true, repo_full_name: '', repo_id: null });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('GitPull');
    expect(names).not.toContain('GitFetch');
    expect(names).not.toContain('GitPush');
    expect(names).not.toContain('PrUpsert');
    expect(names).not.toContain('PrRead');
    expect(names).not.toContain('ConfigRepoPrompt');
    expect(names).not.toContain('ListProjectCommands');
    expect(names).toContain('UpdateSession');
    expect(names).toContain('CurrentSessionInfo');
    expect(names).toContain('ListIssues');
    expect(names).toContain('ReadIssue');
    expect(names).toContain('UpdateIssueStatus');
    expect(names).not.toContain('CreateIssue');
  });
});

describe('CurrentSessionInfo', () => {
  it('returns worktree path and branches for repo sessions', async () => {
    const { tools } = await buildServer({
      base_branch: 'develop',
      local_branch: 'feat/x',
      remote_branch: 'feat/x-remote',
    });
    const result = parseResult(await callTool(tools, 'CurrentSessionInfo'));
    expect(result.ok).toBe(true);
    expect(result.worktree_path).toBe('/tmp/wt');
    expect(result.base_branch).toBe('develop');
    expect(result.remote_branch).toBe('feat/x-remote');
    expect(result.git_diff_against_base).toBe('git diff origin/develop...HEAD');
    expect(result.local_branch).toBe('feat/x');
    expect(result.session_branch).toBeUndefined();
    expect(result.git_commits_to_push).toBe('git rev-list --count origin/feat/x-remote..HEAD');
    expect(result.git_commits_behind_remote).toBe(
      'git rev-list --count HEAD..origin/feat/x-remote'
    );
  });

  it('returns remote_branch and local_branch separately when they differ', async () => {
    const { tools } = await buildServer({
      base_branch: 'main',
      local_branch: 'feat/shared-abcd1234',
      remote_branch: 'feat/shared',
    });
    const result = parseResult(await callTool(tools, 'CurrentSessionInfo'));
    expect(result.remote_branch).toBe('feat/shared');
    expect(result.local_branch).toBe('feat/shared-abcd1234');
    expect(result.git_commits_to_push).toBe('git rev-list --count origin/feat/shared..HEAD');
  });

  it('does not report .baguette.yaml status (that lives in the build prompt)', async () => {
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'CurrentSessionInfo'));
    expect(result.has_baguette_yaml).toBeUndefined();
    expect(result.baguette_config_notice).toBeUndefined();
  });
});

describe('PrRead', () => {
  it('includes ListIssues, ReadIssue and UpdateIssueStatus but not reviewer CRUD', async () => {
    const { tools } = await buildServer();
    const names = tools.map((t) => t.name);
    expect(names).toContain('ListIssues');
    expect(names).toContain('ReadIssue');
    expect(names).toContain('UpdateIssueStatus');
    expect(names).not.toContain('CreateIssue');
    expect(names).not.toContain('CloseIssue');
  });
  it('returns pr_url: null and a message when no PR exists', async () => {
    const { tools } = await buildServer({ pr_url: null, pr_number: null, remote_branch: 'feat' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.ok).toBe(true);
    expect(result.pr_url).toBeNull();
    expect(result.pr_number).toBeNull();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns pr_url and no message when PR exists', async () => {
    const { tools } = await buildServer({
      pr_url: 'https://github.com/owner/repo/pull/42',
      pr_number: 42,
    });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.ok).toBe(true);
    expect(result.pr_url).toBe('https://github.com/owner/repo/pull/42');
    expect(result.message).toBeUndefined();
  });

  it('returns branch from remote_branch', async () => {
    const { tools } = await buildServer({ remote_branch: 'feat/my-branch' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.branch).toBe('feat/my-branch');
  });

  it('falls back to local_branch when remote_branch is null', async () => {
    const { tools } = await buildServer({ remote_branch: null, local_branch: 'created-branch' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.branch).toBe('created-branch');
  });

  it('returns title and description fetched from GitHub when PR exists', async () => {
    const body = `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nGitHub PR body`;
    getOpenPRByNumber.mockResolvedValueOnce({ title: 'GitHub PR title', body });
    const { tools } = await buildServer({
      pr_url: 'https://github.com/owner/repo/pull/42',
      pr_number: 42,
    });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.title).toBe('GitHub PR title');
    expect(result.description).toBe('GitHub PR body');
    expect(getOpenPRByNumber).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42);
  });

  it('strips marker and returns only baguette content when user prefix is present', async () => {
    const body = `My notes\n\n${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nBaguette summary`;
    getOpenPRByNumber.mockResolvedValueOnce({ title: 'PR', body });
    const { tools } = await buildServer({
      pr_url: 'https://github.com/owner/repo/pull/1',
      pr_number: 1,
    });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.description).toBe('Baguette summary');
  });

  it('returns null title and description when no PR exists', async () => {
    const { tools } = await buildServer({ pr_url: null, pr_number: null });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
  });
});

describe('GitPull', () => {
  it('returns ok without calling gitPull when remote_branch is null', async () => {
    const { tools } = await buildServer({ remote_branch: null });
    const result = parseResult(await callTool(tools, 'GitPull'));
    expect(result.ok).toBe(true);
    expect(gitPull).not.toHaveBeenCalled();
  });

  it('calls gitPull with worktreePath, remoteBranch, token and returns result', async () => {
    gitPull.mockResolvedValue({ message: 'Already up to date.' });
    const { tools } = await buildServer({ remote_branch: 'feature-branch' });
    const result = parseResult(await callTool(tools, 'GitPull'));
    expect(result.ok).toBe(true);
    expect(gitPull).toHaveBeenCalledWith('/tmp/wt', 'feature-branch', 'ghtoken');
  });
});

describe('GitFetch', () => {
  it('calls gitFetch and returns result', async () => {
    gitFetch.mockResolvedValue({ ok: true });
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'GitFetch', { branch: 'main' }));
    expect(result.ok).toBe(true);
    expect(gitFetch).toHaveBeenCalledWith('/tmp/wt', 'ghtoken', 'main');
  });
});

describe('GitPush', () => {
  it('returns ok: false when push is rejected', async () => {
    const err = Object.assign(new Error('push rejected: run git-pull to resolve conflict'), {
      rejected: true,
    });
    gitPush.mockRejectedValue(err);
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/conflict/i);
  });

  it('patches session with branch name on success', async () => {
    gitPush.mockResolvedValue({ ok: true, branch: 'feature-branch' });
    const { tools, mockPatch } = await buildServer({
      remote_branch: 'feature-branch',
      local_branch: 'feature-branch-test',
    });
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(true);
    expect(result.branch).toBe('feature-branch');
    expect(gitPush).toHaveBeenCalledWith('/tmp/wt', 'ghtoken', {
      force: false,
      branch: 'feature-branch',
    });
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        remote_branch: 'feature-branch',
      },
      INTERNAL_PATCH_PARAMS
    );
  });

  it('skips push and returns ok message when auto_push is disabled', async () => {
    const { tools, mockPatch } = await buildServer({ auto_push: 0 });
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(gitPush).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('UpdateSession', () => {
  it('patches session label only', async () => {
    const { tools, mockPatch } = await buildServer();
    const result = parseResult(await callTool(tools, 'UpdateSession', { label: 'New label' }));
    expect(result.ok).toBe(true);
    expect(mockPatch).toHaveBeenCalledWith(1, { label: 'New label' }, INTERNAL_PATCH_PARAMS);
  });
});

describe('PrUpsert', () => {
  it('resolves HEAD, creates PR, and patches session when no pr_number', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'feature-branch\n', stderr: '' })
    );
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/1', number: 1 });
    const { tools, mockPatch } = await buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'My PR', description: 'Details' })
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://github.com/owner/repo/pull/1');
    expect(upsertPR).toHaveBeenCalledWith(
      'ghtoken',
      expect.objectContaining({
        head: 'feature-branch',
        body: `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nDetails`,
      })
    );
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      { label: 'My PR', pr_description: 'Details' },
      INTERNAL_PATCH_PARAMS
    );
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        pr_url: 'https://github.com/owner/repo/pull/1',
        pr_number: 1,
        pr_status: 'draft',
      },
      INTERNAL_PATCH_PARAMS
    );
  });

  it('updates existing PR without HEAD lookup; patches label and description', async () => {
    getOpenPRByNumber.mockResolvedValueOnce({ title: 'PR', body: '' });
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/5', number: 5 });
    const { tools, mockPatch } = await buildServer({ pr_number: 5 });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'Updated', description: 'Updated body' })
    );
    expect(result.ok).toBe(true);
    expect(execFile).not.toHaveBeenCalled();
    expect(upsertPR).toHaveBeenCalledWith(
      'ghtoken',
      expect.objectContaining({ body: `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nUpdated body` })
    );
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        label: 'Updated',
        pr_description: 'Updated body',
      },
      INTERNAL_PATCH_PARAMS
    );
  });

  it('preserves user-written content above the marker when updating an existing PR', async () => {
    const existingBody = `My reviewer notes\n\n${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nOld baguette content`;
    getOpenPRByNumber.mockResolvedValueOnce({ title: 'PR', body: existingBody });
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/5', number: 5 });
    const { tools } = await buildServer({ pr_number: 5 });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'Updated', description: 'New baguette content' })
    );
    expect(result.ok).toBe(true);
    expect(upsertPR).toHaveBeenCalledWith(
      'ghtoken',
      expect.objectContaining({
        body: `My reviewer notes\n\n${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nNew baguette content`,
      })
    );
  });

  it('rewrites usage footer from session on each upsert', async () => {
    getOpenPRByNumber.mockResolvedValueOnce({
      title: 'PR',
      body: `Notes\n\n${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nOld\n\n<!-- baguette-footer -->\n\n_claude / \`old\` · In: 0 · Out: 0 · Cache read: 0 · Cache write: 0 · Cost: $0_`,
    });
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/5', number: 5 });
    const { tools } = await buildServer(
      {
        pr_number: 5,
        agent_sdk: 'cursor',
        model: 'new-model',
      },
      {
        usageRows: [
          {
            usage_kind: 'session',
            model: 'new-model',
            agent_sdk: 'cursor',
            cost_usd: '1.50',
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        ],
      }
    );
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'Updated', description: 'Summary' })
    );
    expect(result.ok).toBe(true);
    expect(upsertPR).toHaveBeenCalledWith(
      'ghtoken',
      expect.objectContaining({
        body: expect.stringContaining(
          '<!-- baguette-footer -->\n\n_cursor / `new-model` · In: 1.0k · Out: 200 · Cache read: 0 · Cache write: 0 · Cost: $1.50_'
        ),
      })
    );
    const sentBody = upsertPR.mock.calls[0][1].body;
    expect(sentBody).not.toContain('claude / `old`');
  });

  it('fails and links session when an open PR already exists for HEAD', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'my-feature\n', stderr: '' })
    );
    getOpenPR.mockResolvedValueOnce({
      number: 7,
      html_url: 'https://github.com/owner/repo/pull/7',
      title: 'Already open',
      base_ref: 'main',
      draft: false,
    });
    const { tools, mockPatch } = await buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'New title', description: 'Body' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/);
    expect(upsertPR).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      { label: 'New title', pr_description: 'Body' },
      INTERNAL_PATCH_PARAMS
    );
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        pr_url: 'https://github.com/owner/repo/pull/7',
        pr_number: 7,
        pr_status: 'open',
        label: 'Already open',
      },
      INTERNAL_PATCH_PARAMS
    );
  });

  it('persists label and description but skips GitHub when auto_push is disabled', async () => {
    const { tools, mockPatch } = await buildServer({ pr_number: null, auto_push: 0 });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'My PR', description: 'Details' })
    );
    expect(result.ok).toBe(true);
    expect(upsertPR).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      { label: 'My PR', pr_description: 'Details' },
      INTERNAL_PATCH_PARAMS
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});

describe('ListProjectCommands', () => {
  it('returns ok: true with empty commands and a message when config is missing', async () => {
    loadBaguetteConfig.mockResolvedValue(null);
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.message).toMatch(/ConfigRepoPrompt/);
  });

  it('returns ok: false when config has a parse error', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'Failed to parse YAML' });
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(false);
  });

  it('filters entries missing label or run; returns only valid commands', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: {
        commands: [
          { label: 'Run tests', run: 'npm test' },
          { label: 'Build', run: 'npm run build' },
          { label: 'no-run-field' },
          { run: 'no-label-field' },
          null,
        ],
      },
    });
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([
      { label: 'Run tests', run: 'npm test' },
      { label: 'Build', run: 'npm run build' },
    ]);
  });

  it('returns empty commands array when config has no commands', async () => {
    loadBaguetteConfig.mockResolvedValue({ session: {} });
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
  });
});

describe('RunProjectCommand', () => {
  it('returns ok: false when config is missing', async () => {
    loadBaguetteConfig.mockResolvedValue(null);
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(false);
  });

  it('returns ok: false when label is not found', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Build', run: 'npm run build' }] },
    });
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Unknown' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown/);
  });

  it('returns ok: false when config has a parse error', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'bad YAML' });
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(false);
  });

  it('detached (default): creates task and returns taskId immediately', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0, stdout: 'all tests passed\n' }) }
    );
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(true);
    expect(result.taskId).toBe(99);
    expect(result.label).toBe('Run tests');
    expect(result.status).toBe('running');
    expect(result.exitCode).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_key: 'Run tests' }),
      expect.anything()
    );
  });

  it('detached (default): does not pass onLog/onExit callbacks', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ onLog: expect.anything(), onExit: expect.anything() }),
      expect.anything()
    );
  });

  it('attach: true — rejected when task has attach: false in config', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { tasks: { 'Run tests': { run: 'npm test', attach: false } } },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    const result = parseResult(
      await callTool(tools, 'RunProjectCommand', { label: 'Run tests', attach: true })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/attach: false/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('detached run allowed when task has attach: false in config', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { tasks: { 'Run tests': { run: 'npm test', attach: false } } },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    const result = parseResult(
      await callTool(tools, 'RunProjectCommand', { label: 'Run tests', attach: false })
    );
    expect(result.ok).toBe(true);
    expect(result.taskId).toBe(99);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('attach: true — waits for exit and returns stdout on exit 0', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0, stdout: 'all tests passed\n' }) }
    );
    const result = parseResult(
      await callTool(tools, 'RunProjectCommand', { label: 'Run tests', attach: true })
    );
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdoutLines).toEqual(['all tests passed']);
    expect(result.stderrLines).toEqual([]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_key: 'Run tests' }),
      expect.anything()
    );
  });

  it('attach: true — returns stdout and stderr when command exits non-zero', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 1, stderr: 'Test failed\n' }) }
    );
    const result = parseResult(
      await callTool(tools, 'RunProjectCommand', { label: 'Run tests', attach: true })
    );
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderrLines).toEqual(['Test failed']);
  });

  it('attach: true — returns full stdout as lines without truncation', async () => {
    const huge = `${'x'.repeat(90_000)}\nLAST_LINE\n`;
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0, stdout: huge }) }
    );
    const result = parseResult(
      await callTool(tools, 'RunProjectCommand', { label: 'Run tests', attach: true })
    );
    expect(result.ok).toBe(true);
    const joined = result.stdoutLines.join('\n');
    expect(joined).toBe(huge.replace(/\n$/, ''));
    expect(joined).toContain('LAST_LINE');
    expect(joined.length).toBeGreaterThan(90_000);
  });

  // The tool names the task and forwards args; the tasks service resolves the `run` script
  // from .baguette.yaml and appends the args to it (see appendTaskArgs).
  it('forwards a single file path arg to the tasks service', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'vitest run' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests', args: ['src/foo.test.js'] });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_key: 'Run tests', args: ['src/foo.test.js'] }),
      expect.anything()
    );
  });

  it('forwards multiple args (e.g. --reporter flag with value)', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'vitest run' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    await callTool(tools, 'RunProjectCommand', {
      label: 'Run tests',
      args: ['--reporter', 'verbose', 'src/foo.test.js'],
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        task_key: 'Run tests',
        args: ['--reporter', 'verbose', 'src/foo.test.js'],
      }),
      expect.anything()
    );
  });

  it('never sends a command — the task is named, not spelled out', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_key: 'Run tests', args: [] }),
      expect.anything()
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ command: expect.anything() }),
      expect.anything()
    );
  });

  it('passes extra_env to task create when env is provided', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    await callTool(tools, 'RunProjectCommand', {
      label: 'Run tests',
      env: { MY_VAR: 'hello', ANOTHER: 'world' },
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ extra_env: { MY_VAR: 'hello', ANOTHER: 'world' } }),
      expect.anything()
    );
  });

  it('does not include extra_env when env is omitted', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = await buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0 }) }
    );
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ extra_env: expect.anything() }),
      expect.anything()
    );
  });
});

describe('PrComments', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = await buildServer({ pr_number: null });
    const result = parseResult(await callTool(tools, 'PrComments'));
    expect(result.ok).toBe(false);
  });

  it('calls getPRComments and returns result', async () => {
    getPRComments.mockResolvedValue({ issueComments: [], reviewComments: [] });
    const { tools } = await buildServer({ pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrComments'));
    expect(result.ok).toBe(true);
    expect(getPRComments).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42);
  });
});

describe('PrComment', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = await buildServer({ pr_number: null });
    const result = parseResult(await callTool(tools, 'PrComment', { body: 'hello' }));
    expect(result.ok).toBe(false);
  });

  it('posts general comment via createPRComment when no path/line', async () => {
    createPRComment.mockResolvedValue({ id: 1 });
    const { tools } = await buildServer({ pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrComment', { body: 'Looks good!' }));
    expect(result.ok).toBe(true);
    expect(createPRComment).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      `${SESSION_HEADER}Looks good!`
    );
    expect(createPRLineComment).not.toHaveBeenCalled();
  });

  it('posts inline comment via createPRLineComment when path and line are provided', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRLineComment.mockResolvedValue({ id: 2 });
    const { tools } = await buildServer({ pr_number: 42 });
    const result = parseResult(
      await callTool(tools, 'PrComment', { body: 'Issue here', path: 'src/foo.js', line: 10 })
    );
    expect(result.ok).toBe(true);
    expect(createPRLineComment).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42, {
      body: `${SESSION_HEADER}Issue here`,
      path: 'src/foo.js',
      line: 10,
      commitId: 'abc1234',
      side: undefined,
    });
  });

  it('passes explicit side to createPRLineComment', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRLineComment.mockResolvedValue({ id: 3 });
    const { tools } = await buildServer({ pr_number: 42 });
    await callTool(tools, 'PrComment', {
      body: 'Deleted line',
      path: 'src/foo.js',
      line: 5,
      side: 'LEFT',
    });
    expect(createPRLineComment).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      expect.objectContaining({ side: 'LEFT' })
    );
  });
});

describe('PrReview', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = await buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'approve', body: 'LGTM' })
    );
    expect(result.ok).toBe(false);
  });

  it('maps approve → APPROVE and calls createPRReview', async () => {
    createPRReview.mockResolvedValue({ id: 1 });
    const { tools } = await buildServer({ pr_number: 42 });
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'approve', body: 'LGTM' })
    );
    expect(result.ok).toBe(true);
    expect(createPRReview).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      'APPROVE',
      `${SESSION_HEADER}LGTM`,
      [],
      null
    );
  });

  it('maps request-changes → REQUEST_CHANGES', async () => {
    createPRReview.mockResolvedValue({ id: 2 });
    const { tools } = await buildServer({ pr_number: 42 });
    await callTool(tools, 'PrReview', { event: 'request-changes', body: 'Fix this' });
    expect(createPRReview).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      'REQUEST_CHANGES',
      `${SESSION_HEADER}Fix this`,
      [],
      null
    );
  });

  it('passes inline comments and commitId when comments are provided', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRReview.mockResolvedValue({ id: 3 });
    const { tools } = await buildServer({ pr_number: 42 });
    const comments = [{ body: 'Fix this', path: 'src/foo.js', line: 10 }];
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'comment', body: 'Has issues', comments })
    );
    expect(result.ok).toBe(true);
    expect(createPRReview).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      'COMMENT',
      `${SESSION_HEADER}Has issues`,
      [{ ...comments[0], body: `${SESSION_HEADER}Fix this` }],
      'abc1234'
    );
  });
});

describe('PrWorkflows', () => {
  it('returns empty runs and message when no branch', async () => {
    const { tools } = await buildServer({ remote_branch: null, local_branch: null });
    const result = parseResult(await callTool(tools, 'PrWorkflows'));
    expect(result.ok).toBe(true);
    expect(result.runs).toEqual([]);
    expect(result.checks).toEqual([]);
    expect(result.head_sha).toBeNull();
    expect(typeof result.message).toBe('string');
  });

  it('calls getPRWorkflows with remote_branch and pr_number', async () => {
    getPRWorkflows.mockResolvedValue({
      runs: [{ id: 1, status: 'completed', jobs: [] }],
      checks: [{ name: 'rspec', conclusion: 'success', required: true, app: 'GitHub Actions' }],
      head_sha: 'abc',
    });
    const { tools } = await buildServer({ remote_branch: 'feat/branch', pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrWorkflows'));
    expect(result.ok).toBe(true);
    expect(getPRWorkflows).toHaveBeenCalledWith('ghtoken', 'owner/repo', 'feat/branch', {
      prNumber: 42,
    });
    expect(result.runs).toHaveLength(1);
    expect(result.checks).toHaveLength(1);
    expect(result.head_sha).toBe('abc');
  });

  it('falls back to local_branch when remote_branch is null', async () => {
    getPRWorkflows.mockResolvedValue({ runs: [], checks: [], head_sha: null });
    const { tools } = await buildServer({ remote_branch: null, local_branch: 'created-branch' });
    await callTool(tools, 'PrWorkflows');
    expect(getPRWorkflows).toHaveBeenCalledWith('ghtoken', 'owner/repo', 'created-branch', {
      prNumber: undefined,
    });
  });
});

describe('PrWorkflowLogs', () => {
  it('calls getPRWorkflowLogs with runId and byte range', async () => {
    getPRWorkflowLogs.mockResolvedValue({ logs: 'build failed\n', totalBytes: 5000 });
    const { tools } = await buildServer();
    const result = parseResult(
      await callTool(tools, 'PrWorkflowLogs', { runId: '12345', startByte: 0, endByte: 8000 })
    );
    expect(result.ok).toBe(true);
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '12345', {
      startByte: 0,
      endByte: 8000,
    });
  });

  it('passes negative startByte for suffix byte ranges', async () => {
    getPRWorkflowLogs.mockResolvedValue({ jobs: [] });
    const { tools } = await buildServer();
    await callTool(tools, 'PrWorkflowLogs', { runId: '12345', startByte: -10 });
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '12345', {
      startByte: -10,
      endByte: undefined,
    });
  });

  it('passes undefined byte range when not specified', async () => {
    getPRWorkflowLogs.mockResolvedValue({ logs: '', totalBytes: 0 });
    const { tools } = await buildServer();
    await callTool(tools, 'PrWorkflowLogs', { runId: '99' });
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '99', {
      startByte: undefined,
      endByte: undefined,
    });
  });
});

describe('ReadTaskOutput', () => {
  function makeLogTask(logText) {
    return {
      id: 42,
      session_id: DEFAULT_SESSION.id,
      getLogs: () => logText,
    };
  }

  it('returns the last 10 bytes when startByte is -10 and endByte is -1', async () => {
    const suffix = '0123456789';
    const text = `${'a'.repeat(90)}${suffix}`;
    const { tools } = await buildServer(
      {},
      { tasksGetTask: vi.fn().mockReturnValue(makeLogTask(text)) }
    );
    const result = parseResult(
      await callTool(tools, 'ReadTaskOutput', { taskId: 42, startByte: -10, endByte: -1 })
    );
    expect(result.ok).toBe(true);
    expect(result.log).toBe(suffix);
  });

  it('rejects negative startByte with non-negative endByte', async () => {
    const { tools } = await buildServer(
      {},
      { tasksGetTask: vi.fn().mockReturnValue(makeLogTask('hello')) }
    );
    const result = parseResult(
      await callTool(tools, 'ReadTaskOutput', { taskId: 42, startByte: -1, endByte: 0 })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/negative startByte/i);
  });

  it('returns ok: false when task belongs to another session', async () => {
    const { tools } = await buildServer(
      {},
      {
        tasksGetTask: vi.fn().mockReturnValue({
          id: 42,
          session_id: 999,
          getLogs: () => 'x\n',
        }),
      }
    );
    const result = parseResult(await callTool(tools, 'ReadTaskOutput', { taskId: 42 }));
    expect(result.ok).toBe(false);
  });
});

describe('ShowDiff', () => {
  it('returns ok: true with path and no diff content', async () => {
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'ShowDiff', { path: 'src/foo.js' }));
    expect(result.ok).toBe(true);
    expect(result.path).toBe('src/foo.js');
    expect(result.diff).toBeUndefined();
  });
});

describe('ConfigRepoPrompt', () => {
  it('calls loadPrompt and returns combined prompt text', async () => {
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'ConfigRepoPrompt'));
    expect(result.ok).toBe(true);
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
  });
});

describe('TaskStatus', () => {
  it('returns ok: false when task not found', async () => {
    const { tools } = await buildServer();
    const result = parseResult(await callTool(tools, 'TaskStatus', { taskId: 999 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/999/);
  });

  it('returns ok: false when task belongs to a different session', async () => {
    const task = {
      id: 5,
      session_id: 999,
      label: 'Run tests',
      status: 'running',
      exit_code: null,
      ports: {},
    };
    const { tools } = await buildServer({}, { tasksGetTask: vi.fn().mockReturnValue(task) });
    const result = parseResult(await callTool(tools, 'TaskStatus', { taskId: 5 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not belong/);
  });

  it('returns status and empty ports when task has no ports', async () => {
    const task = {
      id: 7,
      session_id: DEFAULT_SESSION.id,
      label: 'Run tests',
      status: 'exited',
      exit_code: 0,
      ports: {},
    };
    const { tools } = await buildServer({}, { tasksGetTask: vi.fn().mockReturnValue(task) });
    const result = parseResult(await callTool(tools, 'TaskStatus', { taskId: 7 }));
    expect(result.ok).toBe(true);
    expect(result.taskId).toBe(7);
    expect(result.status).toBe('exited');
    expect(result.exit_code).toBe(0);
    expect(result.ports).toEqual({});
    expect(isPortListening).not.toHaveBeenCalled();
  });

  it('checks each port and returns listening status', async () => {
    isPortListening.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const task = {
      id: 8,
      session_id: DEFAULT_SESSION.id,
      label: 'Dev server',
      status: 'running',
      exit_code: null,
      ports: { PORT: 3001, API_PORT: 3002 },
    };
    const { tools } = await buildServer({}, { tasksGetTask: vi.fn().mockReturnValue(task) });
    const result = parseResult(await callTool(tools, 'TaskStatus', { taskId: 8 }));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('running');
    expect(result.ports.PORT).toEqual({ port: 3001, listening: true });
    expect(result.ports.API_PORT).toEqual({ port: 3002, listening: false });
    expect(isPortListening).toHaveBeenCalledWith(3001);
    expect(isPortListening).toHaveBeenCalledWith(3002);
  });
});
