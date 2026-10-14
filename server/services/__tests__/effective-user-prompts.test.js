import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getEffectiveReviewPrompt } from '../effective-user-prompts.js';

describe('getEffectiveReviewPrompt', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-review-prompt-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when no repo file and no extra prompt', async () => {
    expect(await getEffectiveReviewPrompt(tmpDir)).toBe('');
  });

  it('reads .baguette/agents/reviewer.md', async () => {
    await fs.promises.mkdir(path.join(tmpDir, '.baguette', 'agents'), { recursive: true });
    await fs.promises.writeFile(
      path.join(tmpDir, '.baguette', 'agents', 'reviewer.md'),
      'Check SQL.\n'
    );
    expect(await getEffectiveReviewPrompt(tmpDir)).toBe('Check SQL.');
  });

  it('combines repo file with extra review instructions', async () => {
    await fs.promises.mkdir(path.join(tmpDir, '.baguette', 'agents'), { recursive: true });
    await fs.promises.writeFile(
      path.join(tmpDir, '.baguette', 'agents', 'reviewer.md'),
      'Repo review'
    );
    const text = await getEffectiveReviewPrompt(tmpDir, 'One-off extra');
    expect(text).toContain('Repo review');
    expect(text).toContain('One-off extra');
  });
});
