import { describe, expect, it } from 'vitest';
import {
  stripCdWorktreePrefix,
  stripWorktreeFromText,
  stripWorktreePath,
  diffFileDisplayPath,
} from '../paths.js';

const WT = '/data/sessions/abc/worktree';

describe('stripWorktreeFromText', () => {
  it('replaces cd into worktree with cd .', () => {
    expect(stripWorktreeFromText(`cd ${WT} && git status`, WT)).toBe('cd . && git status');
  });

  it('replaces worktree-prefixed file paths with ./', () => {
    expect(stripWorktreeFromText(`cat ${WT}/src/foo.js`, WT)).toBe('cat ./src/foo.js');
  });

  it('leaves text unchanged when worktree path is absent', () => {
    expect(stripWorktreeFromText('pnpm test', WT)).toBe('pnpm test');
  });
});

describe('stripCdWorktreePrefix', () => {
  it('strips a leading cd worktree && prefix', () => {
    expect(stripCdWorktreePrefix(`cd ${WT} && git status`, WT)).toBe('git status');
  });

  it('strips quoted cd worktree prefixes', () => {
    expect(stripCdWorktreePrefix(`cd '${WT}' && pnpm test`, WT)).toBe('pnpm test');
  });

  it('leaves commands without that prefix unchanged', () => {
    expect(stripCdWorktreePrefix(`cat ${WT}/src/foo.js`, WT)).toBe(`cat ${WT}/src/foo.js`);
  });
});

describe('stripWorktreePath', () => {
  it('maps worktree root to .', () => {
    expect(stripWorktreePath(WT, WT)).toBe('.');
  });

  it('maps files under worktree to ./relative', () => {
    expect(stripWorktreePath(`${WT}/client/src/App.jsx`, WT)).toBe('./client/src/App.jsx');
  });
});

describe('diffFileDisplayPath', () => {
  it('prefers newPath over oldPath', () => {
    expect(diffFileDisplayPath({ newPath: 'b.js', oldPath: 'a.js' })).toBe('b.js');
  });

  it('uses oldPath when newPath is /dev/null', () => {
    expect(diffFileDisplayPath({ newPath: '/dev/null', oldPath: 'gone.js' })).toBe('gone.js');
  });

  it('reads snake_case API fields', () => {
    expect(diffFileDisplayPath({ new_path: 'x.ts', old_path: 'x.ts' })).toBe('x.ts');
  });
});
