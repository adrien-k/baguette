import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { getEffectiveAgentPrompt, getEffectiveReviewPrompt } from '../effective-user-prompts.js';

const db = createTestDb({ beforeEach, afterEach });

describe('effective-user-prompts', () => {
  let app;
  let userId;
  let repoId;

  beforeEach(async () => {
    app = feathers();
    app.set('db', db);
    const [uid] = await db('users').insert({
      github_id: 99,
      username: 'prompt-user',
      approved: true,
      agent_prompt: 'Global agent',
      review_prompt: 'Global review',
    });
    userId = uid;
    const [rid] = await db('repos').insert({
      full_name: 'o/r',
      stripped_name: 'o-r',
      bare_path: '/tmp/r',
    });
    repoId = rid;
    await db('user_repos').insert({
      user_id: userId,
      repo_id: repoId,
      agent_prompt: 'Repo agent',
      review_prompt: 'Repo review',
    });
  });

  it('combines user and repo agent prompts', async () => {
    const text = await getEffectiveAgentPrompt(app, userId, repoId);
    expect(text).toBe('Global agent\n\nRepo agent');
  });

  it('combines user and repo review prompts', async () => {
    const text = await getEffectiveReviewPrompt(app, userId, repoId);
    expect(text).toBe('Global review\n\nRepo review');
  });

  it('uses only user prompts when repo_id is null', async () => {
    expect(await getEffectiveAgentPrompt(app, userId, null)).toBe('Global agent');
  });
});
