import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSkillsService } from '../feathers/skills.service.js';
import {
  buildPreloadedSkillsPrompt,
  parseAutoLoadSkillLabels,
  serializeAutoLoadSkillLabels,
} from '../skill-resolution.js';

const db = createTestDb();

describe('skill-resolution', () => {
  let app;
  let userId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 9, username: 'skill-user', status: 'approved' });
    userId = (await db('users').where({ username: 'skill-user' }).first()).id;
    app = feathers();
    app.set('db', db);
    registerSkillsService(app);
    await app.setup();
    await app.service('skills').create(
      {
        label: 'Custom',
        description: 'Mine',
        content: 'Do the custom thing.',
      },
      { user: { id: userId } }
    );
  });

  it('round-trips auto_load_skills labels', () => {
    expect(serializeAutoLoadSkillLabels(['A', 'B'])).toBe('["A","B"]');
    expect(parseAutoLoadSkillLabels('["A","B"]')).toEqual(['A', 'B']);
  });

  it('buildPreloadedSkillsPrompt includes settings and builtin skills', async () => {
    const text = await buildPreloadedSkillsPrompt(app, { user_id: userId }, [
      'Custom',
      'Delegation and orchestration',
    ]);
    expect(text).toContain('## Preloaded skills');
    expect(text).toContain('Do the custom thing.');
    expect(text).toContain('StartReview');
  });
});
