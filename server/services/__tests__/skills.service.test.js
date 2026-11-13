import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { BadRequest, NotFound } from 'feathers/errors';
import { createTestDb } from '../../test-utils/db.js';
import { registerSkillsService } from '../feathers/skills.service.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSkillsService(app);
  return app;
}

const skill = (overrides = {}) => ({
  label: 'Review checklist',
  description: 'Use when reviewing a pull request',
  content: 'Look for missing tests.',
  ...overrides,
});

describe('skills service', () => {
  let app;
  let alice;
  let bob;

  beforeEach(async () => {
    await db('users').insert([
      { github_id: 1, username: 'alice', status: 'approved' },
      { github_id: 2, username: 'bob', status: 'approved' },
    ]);
    alice = await db('users').where({ username: 'alice' }).first();
    bob = await db('users').where({ username: 'bob' }).first();
    app = makeApp(db);
    await app.setup();
  });

  it('creates, lists, and updates only the caller’s skills', async () => {
    const created = await app.service('skills').create(skill(), params(alice));
    await app.service('skills').create(skill({ label: 'Bob only' }), params(bob));

    const aliceSkills = await app.service('skills').find(params(alice));
    expect(aliceSkills).toHaveLength(1);
    expect(aliceSkills[0].label).toBe('Review checklist');
    expect(aliceSkills[0].user_id).toBe(alice.id);

    const patched = await app
      .service('skills')
      .patch(created.id, { content: 'Also check migrations.' }, params(alice));
    expect(patched.content).toBe('Also check migrations.');
    expect(patched.label).toBe('Review checklist');
  });

  it('rejects a duplicate label for the same user and allows it for another', async () => {
    await app.service('skills').create(skill(), params(alice));
    await expect(app.service('skills').create(skill(), params(alice))).rejects.toBeInstanceOf(
      BadRequest
    );
    const bobs = await app.service('skills').create(skill(), params(bob));
    expect(bobs.user_id).toBe(bob.id);
  });

  it('hides another user’s skill on get, patch, and remove', async () => {
    const created = await app.service('skills').create(skill(), params(alice));
    await expect(app.service('skills').get(created.id, params(bob))).rejects.toMatchObject({
      code: 404,
    });
    await expect(
      app.service('skills').patch(created.id, { content: 'nope' }, params(bob))
    ).rejects.toBeInstanceOf(NotFound);
    await expect(app.service('skills').remove(created.id, params(bob))).rejects.toBeInstanceOf(
      NotFound
    );
  });

  it('requires label, description, and content', async () => {
    await expect(
      app.service('skills').create(skill({ description: '  ' }), params(alice))
    ).rejects.toBeInstanceOf(BadRequest);
  });
});
