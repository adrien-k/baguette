import { describe, it, expect } from 'vitest';
import { loadBuiltinSkills } from '../builtin-skills.js';

describe('loadBuiltinSkills', () => {
  it('includes the delegation built-in skill', async () => {
    const skills = await loadBuiltinSkills();
    const delegation = skills.find((s) => s.builtin_id === 'delegation');
    expect(delegation).toMatchObject({
      source: 'builtin',
      label: 'Delegation and orchestration',
      description: expect.stringContaining('subagents'),
      content: expect.stringContaining('StartReview'),
    });
  });
});
