import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadProjectSkills } from '../project-skills.js';

describe('loadProjectSkills', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-project-skills-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when skills dir is missing', async () => {
    expect(await loadProjectSkills(tmpDir)).toEqual([]);
  });

  it('parses frontmatter label, description, and body content', async () => {
    const skillsDir = path.join(tmpDir, '.baguette', 'skills');
    await fs.promises.mkdir(skillsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillsDir, 'review.md'),
      `---
label: PR review
description: Use when reviewing pull requests
---
Check tests and error handling.
`
    );
    const skills = await loadProjectSkills(tmpDir);
    expect(skills).toEqual([
      {
        label: 'PR review',
        description: 'Use when reviewing pull requests',
        content: 'Check tests and error handling.',
        source: 'project',
        rel_path: path.join('.baguette', 'skills', 'review.md'),
      },
    ]);
  });

  it('skips invalid files and duplicate labels', async () => {
    const skillsDir = path.join(tmpDir, '.baguette', 'skills');
    await fs.promises.mkdir(skillsDir, { recursive: true });
    await fs.promises.writeFile(path.join(skillsDir, 'a.md'), 'no frontmatter\n');
    await fs.promises.writeFile(
      path.join(skillsDir, 'one.md'),
      `---
label: Dup
description: first
---
One
`
    );
    await fs.promises.writeFile(
      path.join(skillsDir, 'two.md'),
      `---
label: Dup
description: second
---
Two
`
    );
    const skills = await loadProjectSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('first');
  });
});
