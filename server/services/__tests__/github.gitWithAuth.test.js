/**
 * Unit tests for gitWithAuth / ensureMainClone GitHub HTTPS vs local.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { TEST_REPOS_DIR, TEST_DATA_DIR } = vi.hoisted(() => {
  const root = `/tmp/baguette-git-auth-${Math.random().toString(36).slice(2)}`;
  return {
    TEST_DATA_DIR: root,
    TEST_REPOS_DIR: `${root}/repos`,
  };
});

const { execFileMock } = vi.hoisted(() => {
  const mock = vi.fn();
  mock[Symbol.for('nodejs.util.promisify.custom')] = async (cmd, args, opts) => {
    mock(cmd, args, opts);
    return { stdout: '', stderr: '' };
  };
  return { execFileMock: mock };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execFile: execFileMock };
});

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DATA_DIR: TEST_DATA_DIR,
    REPOS_DIR: TEST_REPOS_DIR,
    resolveDataDirRelativePath: (subpath) => {
      if (subpath == null || subpath === '') return subpath;
      if (path.isAbsolute(subpath)) return subpath;
      return path.join(TEST_DATA_DIR, subpath);
    },
    resolveRepoPath: (repo) => {
      if (!repo) return undefined;
      const stored = repo.repo_path;
      if (stored == null || stored === '') {
        return repo.stripped_name
          ? path.join(TEST_REPOS_DIR, repo.stripped_name, 'main')
          : undefined;
      }
      if (path.isAbsolute(stored)) return stored;
      return path.join(TEST_DATA_DIR, stored);
    },
  };
});

import {
  gitAuthArgs,
  gitWithAuth,
  gitWithToken,
  buildGitAuthInvocation,
  normalizeGitAuth,
  ensureMainClone,
} from '../github.js';

function gitCalls() {
  return execFileMock.mock.calls.filter(([cmd]) => cmd === 'git');
}

function cloneArgs() {
  const call = gitCalls().find(([, args]) => Array.isArray(args) && args.includes('clone'));
  return call?.[1] ?? [];
}

describe('normalizeGitAuth / buildGitAuthInvocation', () => {
  it('treats a token string as github HTTPS extraheader auth', () => {
    expect(normalizeGitAuth('ghs_abc')).toEqual({ mode: 'github', token: 'ghs_abc' });
    const invocation = buildGitAuthInvocation({ mode: 'github', token: 'ghs_abc' }, ['fetch']);
    expect(invocation.args).toEqual([...gitAuthArgs('ghs_abc'), 'fetch']);
    expect(invocation.opts.env?.GIT_SSH_COMMAND).toBeUndefined();
  });

  it('treats null as local (plain git, no extraheader)', () => {
    expect(normalizeGitAuth(null)).toEqual({ mode: 'local', token: null });
    const invocation = buildGitAuthInvocation({ mode: 'local' }, ['status']);
    expect(invocation.args).toEqual(['status']);
    expect(invocation.args.join(' ')).not.toContain('extraheader');
  });
});

beforeAll(() => {
  fs.mkdirSync(TEST_REPOS_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.promises.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('gitWithAuth', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('github mode prepends extraheader args', async () => {
    await gitWithAuth({ mode: 'github', token: 'tok' }, ['fetch', 'origin']);
    const [, args] = gitCalls().at(-1);
    expect(args).toEqual([...gitAuthArgs('tok'), 'fetch', 'origin']);
    expect(args.join(' ')).toContain('extraheader');
  });

  it('gitWithToken remains a github/local wrapper', async () => {
    await gitWithToken('tok', ['status']);
    const [, args] = gitCalls().at(-1);
    expect(args.slice(0, 2)).toEqual(gitAuthArgs('tok'));

    execFileMock.mockClear();
    await gitWithToken(null, ['status']);
    const [, localArgs] = gitCalls().at(-1);
    expect(localArgs).toEqual(['status']);
  });
});

describe('ensureMainClone', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    fs.mkdirSync(TEST_REPOS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(TEST_REPOS_DIR, { recursive: true, force: true });
  });

  it('github mode still clones https://github.com/<full_name>.git with extraheader', async () => {
    await ensureMainClone(
      {
        full_name: 'acme/app',
        stripped_name: 'acme-app-gh',
        access_mode: 'github',
      },
      'ghs_token'
    );
    const args = cloneArgs();
    expect(args).toContain('https://github.com/acme/app.git');
    expect(args.join(' ')).toContain('extraheader');
  });
});
