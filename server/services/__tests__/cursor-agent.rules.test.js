/**
 * Cursor prompt injection via always-apply .mdc rules files.
 *
 * Session builders and reviewers use the same filename (`system-prompt.mdc`) under
 * per-mode folders of the session cursor-dir:
 *   <cwd-parent>/build/.cursor/rules/system-prompt.mdc  — session builder prompt
 *   <cwd-parent>/review/.cursor/rules/system-prompt.mdc — reviewer prompt
 * The cursor-dir sits alongside whatever working directory the session has (the
 * session worktree, or the shared repos dir for global sessions); sessions without
 * a worktree path get no rules dir. Agent setup only ever receives its own mode
 * folder, so an agent loads exactly one prompt. Prompt files left by older Baguette
 * versions are never pointed at by agent setup and are left untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CursorAgentService } from '../feathers/cursor-agent.service.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const BUILD_DESCRIPTION = 'Baguette session rules (always applied)';
const REVIEW_DESCRIPTION = 'Baguette review rules (always applied)';

describe('cursor always-apply prompt rules', () => {
  let baseDir;
  let service;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-rules-'));
    service = new CursorAgentService();
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  // worktree_path must end in "worktree" so the cursor-dir resolves alongside it.
  const fakeSession = (id) => ({
    id,
    worktree_path: path.join(baseDir, `session-${id}`, 'worktree'),
  });
  const cursorDirFor = (id) => path.join(baseDir, `session-${id}`, 'cursor-dir');
  const rulesDir = (root) => path.join(root, '.cursor', 'rules');
  const readRule = (root, filename) => fs.readFileSync(path.join(rulesDir(root), filename), 'utf8');

  describe('writePromptRule', () => {
    it('writes the build prompt under cursor-dir/build and returns that root', async () => {
      const session = fakeSession(1);

      const root = await service.writePromptRule(session, 'build', {
        description: BUILD_DESCRIPTION,
        body: 'You are the builder.',
      });

      expect(root).toBe(path.join(cursorDirFor(1), 'build'));
      const content = readRule(root, 'system-prompt.mdc');
      expect(content).toContain(`description: ${BUILD_DESCRIPTION}`);
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('You are the builder.');
    });

    it('writes the review prompt under cursor-dir/review, side by side with build', async () => {
      const session = fakeSession(2);

      const buildRoot = await service.writePromptRule(session, 'build', {
        description: BUILD_DESCRIPTION,
        body: 'You are the builder.',
      });
      const reviewRoot = await service.writePromptRule(session, 'review', {
        description: REVIEW_DESCRIPTION,
        body: 'You are the reviewer.',
      });

      expect(reviewRoot).toBe(path.join(cursorDirFor(2), 'review'));
      expect(readRule(reviewRoot, 'system-prompt.mdc')).toContain('You are the reviewer.');
      // Both prompts coexist in their own folders — each agent only gets its own.
      expect(readRule(buildRoot, 'system-prompt.mdc')).toContain('You are the builder.');
    });

    it('sits the cursor-dir alongside any working directory, not just worktrees', async () => {
      // Global sessions work in the shared repos dir — no "worktree" basename.
      const reposDir = path.join(baseDir, 'repos');
      const session = { id: 20, worktree_path: reposDir };

      const root = await service.writePromptRule(session, 'build', {
        description: BUILD_DESCRIPTION,
        body: 'You are the global assistant.',
      });

      expect(root).toBe(path.join(baseDir, 'cursor-dir', 'build'));
      expect(readRule(root, 'system-prompt.mdc')).toContain('You are the global assistant.');
    });

    it('returns null and writes nothing for sessions without a worktree path', async () => {
      const session = { id: 21, worktree_path: null };

      const root = await service.writePromptRule(session, 'build', {
        description: BUILD_DESCRIPTION,
        body: 'You are the builder.',
      });

      expect(root).toBeNull();
      expect(fs.existsSync(path.join(baseDir, 'cursor-dir'))).toBe(false);
      expect(fs.existsSync(cursorDirFor(21))).toBe(false);
    });

    it('leaves files left by older Baguette versions in the cursor-dir root alone', async () => {
      const session = fakeSession(3);
      const rootRulesDir = rulesDir(cursorDirFor(3));
      fs.mkdirSync(rootRulesDir, { recursive: true });
      fs.writeFileSync(path.join(rootRulesDir, 'baguette.mdc'), 'old builder prompt');
      fs.writeFileSync(path.join(rootRulesDir, 'review.mdc'), 'old review prompt');
      fs.writeFileSync(path.join(rootRulesDir, 'system-prompt.mdc'), 'previous layout');
      fs.writeFileSync(path.join(rootRulesDir, 'my-own-rule.mdc'), 'hands off');

      await service.writePromptRule(session, 'build', {
        description: BUILD_DESCRIPTION,
        body: 'You are the builder.',
      });
      await service.writePromptRule(session, 'review', {
        description: REVIEW_DESCRIPTION,
        body: 'You are the reviewer.',
      });

      // Legacy locations are never passed to agent setup, so nothing purges them.
      const readRootFile = (name) => fs.readFileSync(path.join(rootRulesDir, name), 'utf8');
      expect(readRootFile('baguette.mdc')).toBe('old builder prompt');
      expect(readRootFile('review.mdc')).toBe('old review prompt');
      expect(readRootFile('system-prompt.mdc')).toBe('previous layout');
      expect(readRootFile('my-own-rule.mdc')).toBe('hands off');
    });

    it('rejects unknown modes', async () => {
      await expect(
        service.writePromptRule(fakeSession(4), 'plan', { description: 'x', body: 'y' })
      ).rejects.toThrow('Unknown cursor prompt mode: plan');
    });
  });

  describe('writeAlwaysApplyRule', () => {
    let rulesRoot;

    beforeEach(() => {
      rulesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baguette-rule-root-'));
    });

    afterEach(() => {
      fs.rmSync(rulesRoot, { recursive: true, force: true });
    });

    it('writes the prompt as system-prompt.mdc by default', async () => {
      const root = await service.writeAlwaysApplyRule(rulesRoot, {
        description: BUILD_DESCRIPTION,
        body: 'You are the builder.',
      });

      expect(root).toBe(rulesRoot);
      const content = readRule(rulesRoot, 'system-prompt.mdc');
      expect(content).toContain(`description: ${BUILD_DESCRIPTION}`);
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('You are the builder.');
    });

    it('leaves other files in the rules dir alone', async () => {
      fs.mkdirSync(rulesDir(rulesRoot), { recursive: true });
      fs.writeFileSync(path.join(rulesDir(rulesRoot), 'baguette.mdc'), 'old prompt');
      fs.writeFileSync(path.join(rulesDir(rulesRoot), 'my-own-rule.mdc'), 'hands off');

      await service.writeAlwaysApplyRule(rulesRoot, {
        description: REVIEW_DESCRIPTION,
        body: 'You are the reviewer.',
      });

      expect(readRule(rulesRoot, 'baguette.mdc')).toBe('old prompt');
      expect(readRule(rulesRoot, 'my-own-rule.mdc')).toBe('hands off');
      expect(readRule(rulesRoot, 'system-prompt.mdc')).toContain('You are the reviewer.');
    });
  });
});
