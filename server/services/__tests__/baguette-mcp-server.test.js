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

vi.mock('../agent-settings.js', () => ({ getEffectiveGithubToken: vi.fn(() => 'ghtoken') }));
vi.mock('../logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DOCKER_COMPOSE_PATH: '/docker-compose.yml',
  };
});
vi.mock('../prompts/loadPrompt.js', () => ({ default: vi.fn().mockResolvedValue('prompt text') }));

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
  created_branch: null,
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
    const task = { id: 99, label: data.label ?? null, status: 'running' };
    setImmediate(() => {
      if (stdout) data.onLog?.(task.id, 'stdout', stdout);
      if (stderr) data.onLog?.(task.id, 'stderr', stderr);
      setImmediate(() => data.onExit?.(task.id, exitCode));
    });
    return Promise.resolve(task);
  });
}

function makeApp(sessionData, { tasksCreate } = {}) {
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
  const db = (table) => {
    if (table === 'sessions')
      return { where: () => ({ first: async () => ({ ...sessionSnapshot }) }) };
    if (table === 'users')
      return { where: () => ({ first: async () => ({ id: 1, github_token: 'tok' }) }) };
    if (table === 'repos')
      return {
        where: () => ({
          first: async () => ({ id: sessionSnapshot.repo_id ?? 7, full_name: sessionSnapshot.repo_full_name ?? 'owner/repo', default_branch: 'main' }),
        }),
      };
    return { where: () => ({ first: async () => null }) };
  };
  const app = {
    get: (key) => (key === 'db' ? db : null),
    service: (name) => {
      if (name === 'users') return { get: async () => ({ id: 1, github_token: 'tok' }) };
      return { patch: mockPatch, getTaskEnv: mockGetTaskEnv, create: mockCreate };
    },
  };
  return { app, mockPatch, mockGetTaskEnv, mockCreate };
}

function buildServer(sessionOverrides = {}, appOpts = {}) {
  const sessionRow = { ...DEFAULT_SESSION, ...sessionOverrides };
  const { app, mockPatch, mockGetTaskEnv, mockCreate } = makeApp(sessionRow, appOpts);
  buildBaguetteMcpServer(sessionRow, app);
  const tools = createSdkMcpServer.mock.calls[0][0].tools;
  return { tools, mockPatch, mockGetTaskEnv, mockCreate };
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

describe('PrRead', () => {
  it('returns pr_url: null and a message when no PR exists', async () => {
    const { tools } = buildServer({ pr_url: null, pr_number: null, remote_branch: 'feat' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.ok).toBe(true);
    expect(result.pr_url).toBeNull();
    expect(result.pr_number).toBeNull();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns pr_url and no message when PR exists', async () => {
    const { tools } = buildServer({
      pr_url: 'https://github.com/owner/repo/pull/42',
      pr_number: 42,
    });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.ok).toBe(true);
    expect(result.pr_url).toBe('https://github.com/owner/repo/pull/42');
    expect(result.message).toBeUndefined();
  });

  it('returns branch from remote_branch', async () => {
    const { tools } = buildServer({ remote_branch: 'feat/my-branch' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.branch).toBe('feat/my-branch');
  });

  it('falls back to created_branch when remote_branch is null', async () => {
    const { tools } = buildServer({ remote_branch: null, created_branch: 'created-branch' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.branch).toBe('created-branch');
  });

  it('returns title and description fetched from GitHub when PR exists', async () => {
    const body = `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nGitHub PR body`;
    getOpenPRByNumber.mockResolvedValueOnce({ title: 'GitHub PR title', body });
    const { tools } = buildServer({
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
    const { tools } = buildServer({
      pr_url: 'https://github.com/owner/repo/pull/1',
      pr_number: 1,
    });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.description).toBe('Baguette summary');
  });

  it('returns null title and description when no PR exists', async () => {
    const { tools } = buildServer({ pr_url: null, pr_number: null });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
  });
});

describe('GitPull', () => {
  it('returns ok without calling gitPull when remote_branch is null', async () => {
    const { tools } = buildServer({ remote_branch: null });
    const result = parseResult(await callTool(tools, 'GitPull'));
    expect(result.ok).toBe(true);
    expect(gitPull).not.toHaveBeenCalled();
  });

  it('calls gitPull with worktreePath, remoteBranch, token and returns result', async () => {
    gitPull.mockResolvedValue({ message: 'Already up to date.' });
    const { tools } = buildServer({ remote_branch: 'feature-branch' });
    const result = parseResult(await callTool(tools, 'GitPull'));
    expect(result.ok).toBe(true);
    expect(gitPull).toHaveBeenCalledWith('/tmp/wt', 'feature-branch', 'ghtoken');
  });
});

describe('GitFetch', () => {
  it('calls gitFetch and returns result', async () => {
    gitFetch.mockResolvedValue({ ok: true });
    const { tools } = buildServer();
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
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/conflict/i);
  });

  it('patches session with branch name on success', async () => {
    gitPush.mockResolvedValue({ ok: true, branch: 'feature-branch' });
    const { tools, mockPatch } = buildServer();
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(true);
    expect(result.branch).toBe('feature-branch');
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        remote_branch: 'feature-branch',
        created_branch: 'feature-branch',
      },
      INTERNAL_PATCH_PARAMS
    );
  });

  it('skips push and returns ok message when auto_push is disabled', async () => {
    const { tools, mockPatch } = buildServer({ auto_push: 0 });
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(gitPush).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('PrUpsert', () => {
  it('resolves HEAD, creates PR, and patches session when no pr_number', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'feature-branch\n', stderr: '' })
    );
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/1', number: 1 });
    const { tools, mockPatch } = buildServer({ pr_number: null });
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
    const { tools, mockPatch } = buildServer({ pr_number: 5 });
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
    const { tools } = buildServer({ pr_number: 5 });
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
    const { tools, mockPatch } = buildServer({ pr_number: null });
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
    const { tools, mockPatch } = buildServer({ pr_number: null, auto_push: 0 });
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
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.message).toMatch(/ConfigRepoPrompt/);
  });

  it('returns ok: false when config has a parse error', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'Failed to parse YAML' });
    const { tools } = buildServer();
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
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([
      { label: 'Run tests', run: 'npm test' },
      { label: 'Build', run: 'npm run build' },
    ]);
  });

  it('returns empty commands array when config has no commands', async () => {
    loadBaguetteConfig.mockResolvedValue({ session: {} });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
  });
});

describe('RunProjectCommand', () => {
  it('returns ok: false when config is missing', async () => {
    loadBaguetteConfig.mockResolvedValue(null);
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(false);
  });

  it('returns ok: false when label is not found', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Build', run: 'npm run build' }] },
    });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Unknown' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown/);
  });

  it('returns ok: false when config has a parse error', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'bad YAML' });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(false);
  });

  it('detached (default): creates task and returns taskId immediately', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = buildServer(
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
      expect.objectContaining({ command: 'npm test' }),
      expect.anything()
    );
  });

  it('detached (default): does not pass onLog/onExit callbacks', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ onLog: expect.anything(), onExit: expect.anything() }),
      expect.anything()
    );
  });

  it('attach: true — waits for exit and returns stdout on exit 0', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = buildServer(
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
      expect.objectContaining({ command: 'npm test' }),
      expect.anything()
    );
  });

  it('attach: true — returns stdout and stderr when command exits non-zero', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools } = buildServer(
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
    const { tools } = buildServer(
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

  it('appends a single file path arg', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'vitest run' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests', args: ['src/foo.test.js'] });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'vitest run src/foo.test.js' }),
      expect.anything()
    );
  });

  it('appends multiple args (e.g. --grep flag with pattern)', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'vitest run' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', {
      label: 'Run tests',
      args: ['--reporter', 'verbose', 'src/foo.test.js'],
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'vitest run --reporter verbose src/foo.test.js' }),
      expect.anything()
    );
  });

  it('runs without extra args when args is omitted', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm test' }),
      expect.anything()
    );
  });
});

describe('PrComments', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = buildServer({ pr_number: null });
    const result = parseResult(await callTool(tools, 'PrComments'));
    expect(result.ok).toBe(false);
  });

  it('calls getPRComments and returns result', async () => {
    getPRComments.mockResolvedValue({ issueComments: [], reviewComments: [] });
    const { tools } = buildServer({ pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrComments'));
    expect(result.ok).toBe(true);
    expect(getPRComments).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42);
  });
});

describe('PrComment', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = buildServer({ pr_number: null });
    const result = parseResult(await callTool(tools, 'PrComment', { body: 'hello' }));
    expect(result.ok).toBe(false);
  });

  it('posts general comment via createPRComment when no path/line', async () => {
    createPRComment.mockResolvedValue({ id: 1 });
    const { tools } = buildServer({ pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrComment', { body: 'Looks good!' }));
    expect(result.ok).toBe(true);
    expect(createPRComment).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42, `${SESSION_HEADER}Looks good!`);
    expect(createPRLineComment).not.toHaveBeenCalled();
  });

  it('posts inline comment via createPRLineComment when path and line are provided', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRLineComment.mockResolvedValue({ id: 2 });
    const { tools } = buildServer({ pr_number: 42 });
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
    const { tools } = buildServer({ pr_number: 42 });
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
    const { tools } = buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'approve', body: 'LGTM' })
    );
    expect(result.ok).toBe(false);
  });

  it('maps approve → APPROVE and calls createPRReview', async () => {
    createPRReview.mockResolvedValue({ id: 1 });
    const { tools } = buildServer({ pr_number: 42 });
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
    const { tools } = buildServer({ pr_number: 42 });
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
    const { tools } = buildServer({ pr_number: 42 });
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
    const { tools } = buildServer({ remote_branch: null, created_branch: null });
    const result = parseResult(await callTool(tools, 'PrWorkflows'));
    expect(result.ok).toBe(true);
    expect(result.runs).toEqual([]);
    expect(typeof result.message).toBe('string');
  });

  it('calls getPRWorkflows with remote_branch', async () => {
    getPRWorkflows.mockResolvedValue([{ id: 1, status: 'completed' }]);
    const { tools } = buildServer({ remote_branch: 'feat/branch' });
    const result = parseResult(await callTool(tools, 'PrWorkflows'));
    expect(result.ok).toBe(true);
    expect(getPRWorkflows).toHaveBeenCalledWith('ghtoken', 'owner/repo', 'feat/branch');
    expect(result.runs).toHaveLength(1);
  });

  it('falls back to created_branch when remote_branch is null', async () => {
    getPRWorkflows.mockResolvedValue([]);
    const { tools } = buildServer({ remote_branch: null, created_branch: 'created-branch' });
    await callTool(tools, 'PrWorkflows');
    expect(getPRWorkflows).toHaveBeenCalledWith('ghtoken', 'owner/repo', 'created-branch');
  });
});

describe('PrWorkflowLogs', () => {
  it('calls getPRWorkflowLogs with runId and byte range', async () => {
    getPRWorkflowLogs.mockResolvedValue({ logs: 'build failed\n', totalBytes: 5000 });
    const { tools } = buildServer();
    const result = parseResult(
      await callTool(tools, 'PrWorkflowLogs', { runId: '12345', startByte: 0, endByte: 8000 })
    );
    expect(result.ok).toBe(true);
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '12345', {
      startByte: 0,
      endByte: 8000,
    });
  });

  it('passes undefined byte range when not specified', async () => {
    getPRWorkflowLogs.mockResolvedValue({ logs: '', totalBytes: 0 });
    const { tools } = buildServer();
    await callTool(tools, 'PrWorkflowLogs', { runId: '99' });
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '99', {
      startByte: undefined,
      endByte: undefined,
    });
  });
});


describe('ShowDiff', () => {
  it('returns ok: true with path and no diff content', async () => {
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ShowDiff', { path: 'src/foo.js' }));
    expect(result.ok).toBe(true);
    expect(result.path).toBe('src/foo.js');
    expect(result.diff).toBeUndefined();
  });
});

describe('ConfigRepoPrompt', () => {
  it('calls loadPrompt and returns combined prompt text', async () => {
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ConfigRepoPrompt'));
    expect(result.ok).toBe(true);
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
  });
});
