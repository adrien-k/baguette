import { describe, expect, it } from 'vitest';
import { stripCdWorktreePrefix, stripWorktreeFromText, stripWorktreePath } from '../paths.js';

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
