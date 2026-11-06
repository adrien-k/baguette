import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../../../test-utils/db.js';
import { registerSkillsService } from '../../../feathers/skills.service.js';
import { createListSkillsTool, createReadSkillTool } from '../skills.js';

const db = createTestDb();

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSkillsService(app);
  return app;
}

function payload(result) {
  return JSON.parse(result.content[0].text);
}

describe('skill MCP tools', () => {
  let app;
  let alice;
  let bob;

  beforeEach(async () => {
    await db('users').insert([
      { github_id: 1, username: 'alice', approved: true },
      { github_id: 2, username: 'bob', approved: true },
    ]);
    alice = await db('users').where({ username: 'alice' }).first();
    bob = await db('users').where({ username: 'bob' }).first();
    app = makeApp(db);
    await app.setup();
    await app.service('skills').create(
      {
        label: 'Review checklist',
        description: 'Use when reviewing a pull request',
        content: 'Look for missing tests.',
      },
      { user: alice }
    );
    await app.service('skills').create(
      {
        label: 'Bob secret',
        description: 'Only Bob',
        content: 'Do not share.',
      },
      { user: bob }
    );
  });

  it('lists labels and descriptions without content', async () => {
    const result = await createListSkillsTool({ app, userId: alice.id }).handler();
    const body = payload(result);
    expect(body.ok).toBe(true);
    expect(body.skills).toEqual([
      {
        id: expect.any(Number),
        label: 'Review checklist',
        description: 'Use when reviewing a pull request',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('Look for missing tests');
    expect(JSON.stringify(body)).not.toContain('Bob secret');
  });

  it('loads one skill by label and hides other users’ skills', async () => {
    const loaded = await createReadSkillTool({ app, userId: alice.id }).handler({
      label: 'Review checklist',
    });
    expect(payload(loaded).skill.content).toBe('Look for missing tests.');

    const missing = await createReadSkillTool({ app, userId: alice.id }).handler({
      label: 'Bob secret',
    });
    expect(payload(missing)).toMatchObject({ ok: false });
  });
});
