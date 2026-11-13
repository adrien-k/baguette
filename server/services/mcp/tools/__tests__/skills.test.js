import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../../../test-utils/db.js';
import { registerSkillsService } from '../../../feathers/skills.service.js';
import {
  createListSkillsTool,
  createReadSkillTool,
  createCreateSkillTool,
  createUpdateSkillTool,
  createDeleteSkillTool,
} from '../skills.js';

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
      { github_id: 1, username: 'alice', status: 'approved' },
      { github_id: 2, username: 'bob', status: 'approved' },
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

  it('creates a skill and returns it without other users seeing it', async () => {
    const result = await createCreateSkillTool({ app, userId: alice.id }).handler({
      label: 'Migration notes',
      description: 'Use when editing SQLite migrations',
      content: 'Beware of Knex table rebuilds.',
    });
    const body = payload(result);
    expect(body).toMatchObject({
      ok: true,
      skill: { label: 'Migration notes', description: 'Use when editing SQLite migrations' },
    });

    const listed = payload(await createListSkillsTool({ app, userId: bob.id }).handler());
    expect(listed.skills.map((s) => s.label)).toEqual(['Bob secret']);
  });

  it('rejects duplicate labels and missing fields on create', async () => {
    const dup = await createCreateSkillTool({ app, userId: alice.id }).handler({
      label: 'Review checklist',
      description: 'dup',
      content: 'dup',
    });
    expect(payload(dup)).toMatchObject({ ok: false });

    const noContent = await createCreateSkillTool({ app, userId: alice.id }).handler({
      label: 'Incomplete',
      description: 'no content',
    });
    expect(payload(noContent)).toMatchObject({ ok: false });
  });

  it('updates by label, by id, and renames via new_label', async () => {
    const renamed = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      label: 'Review checklist',
      new_label: 'PR review',
    });
    expect(payload(renamed)).toMatchObject({ ok: true, skill: { label: 'PR review' } });

    const updated = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      label: 'PR review',
      content: 'Check for toasts too.',
    });
    const skillData = payload(updated).skill;
    expect(skillData).toMatchObject({
      label: 'PR review',
      content: 'Check for toasts too.',
      description: 'Use when reviewing a pull request',
    });

    const byId = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      skill_id: skillData.id,
      description: 'Use when reviewing any pull request',
    });
    expect(payload(byId).skill.description).toBe('Use when reviewing any pull request');
  });

  it('update errors: unknown skill, nothing to change, no identifier', async () => {
    const unknown = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      label: 'Nope',
      description: 'x',
    });
    expect(payload(unknown)).toMatchObject({ ok: false });

    const bobSkill = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      label: 'Bob secret',
      description: 'x',
    });
    expect(payload(bobSkill)).toMatchObject({ ok: false });

    const noChange = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      label: 'Review checklist',
    });
    expect(payload(noChange)).toMatchObject({ ok: false });

    const noIdentifier = await createUpdateSkillTool({ app, userId: alice.id }).handler({
      description: 'x',
    });
    expect(payload(noIdentifier)).toMatchObject({
      ok: false,
    });
  });

  it('deletes by id and by label and keeps other users’ skills', async () => {
    const deleted = await createDeleteSkillTool({ app, userId: alice.id }).handler({
      label: 'Review checklist',
    });
    expect(payload(deleted)).toMatchObject({ ok: true, deleted: true });

    const bobSkill = payload(
      await createDeleteSkillTool({ app, userId: alice.id }).handler({ label: 'Bob secret' })
    );
    expect(bobSkill).toMatchObject({ ok: false });
    expect(
      await createDeleteSkillTool({ app, userId: bob.id }).handler({ label: 'Bob secret' })
    ).toBeTruthy();

    const unknown = await createDeleteSkillTool({ app, userId: alice.id }).handler({
      skill_id: 9999,
    });
    expect(payload(unknown)).toMatchObject({ ok: false });

    const noIdentifier = await createDeleteSkillTool({ app, userId: alice.id }).handler({});
    expect(payload(noIdentifier)).toMatchObject({ ok: false });
  });
});
