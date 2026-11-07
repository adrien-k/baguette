import { z } from 'zod';
import { fail, ok } from '../lib/result.js';

const LIST_DESCRIPTION =
  'List skills saved on this account (Settings → Skills). Returns id, label, and description only — call ReadSkill with the label to load the content. Skills are not included in the prompt.';

const READ_DESCRIPTION =
  'Load one skill by the exact label from ListSkills. Returns the label, description, and full content. Use this when a skill description matches the task, then follow that content.';

const CREATE_DESCRIPTION =
  'Create a skill saved on this account (Settings → Skills). Label must be unique per account. Agents can later discover it via ListSkills and load it with ReadSkill.';

const UPDATE_DESCRIPTION =
  'Update one of this account’s skills (Settings → Skills). Identify it with skill_id or label (as returned by ListSkills), then pass only the fields to change. Use new_label to rename a skill.';

const DELETE_DESCRIPTION =
  'Delete a skill from this account (Settings → Skills) permanently. Identify it with skill_id or label from ListSkills.';

const SKILL_USER_PARAMS = { provider: 'rest' };

function skillParamsFor(userId) {
  return { ...SKILL_USER_PARAMS, user: { id: userId } };
}

async function skillsForUser(app, userId) {
  const rows = await app.service('skills').find({
    user: { id: userId },
    paginate: false,
  });
  return Array.isArray(rows) ? rows : (rows?.data ?? []);
}

function skillToApi(skill) {
  return {
    id: skill.id,
    label: skill.label,
    description: skill.description,
    content: skill.content,
  };
}

async function findOwnSkill(app, userId, { skillId, label }) {
  if (skillId != null) {
    try {
      return await app.service('skills').get(skillId, skillParamsFor(userId));
    } catch {
      return null;
    }
  }
  const wanted = String(label ?? '').trim();
  if (!wanted) return null;
  const rows = await skillsForUser(app, userId);
  return rows.find((row) => row.label === wanted) ?? null;
}

/** `skill_id` or `label` must identify the target skill. Returns an error message or null. */
function identifierError(params) {
  if (params.skill_id != null) return null;
  if (String(params.label ?? '').trim()) return null;
  return 'Provide skill_id or label to identify the skill';
}

export function createListSkillsTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ListSkills',
    description: LIST_DESCRIPTION,
    schema: {},
    handler: async () => {
      const rows = await skillsForUser(app, userId);
      return ok({
        skills: rows.map((skill) => ({
          id: skill.id,
          label: skill.label,
          description: skill.description,
        })),
      });
    },
  };
}

export function createReadSkillTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'ReadSkill',
    description: READ_DESCRIPTION,
    schema: {
      label: z.string().describe('Exact skill label from ListSkills'),
    },
    handler: async ({ label }) => {
      const wanted = String(label ?? '').trim();
      if (!wanted) return fail('label is required');
      const rows = await skillsForUser(app, userId);
      const skill = rows.find((row) => row.label === wanted);
      if (!skill) return fail(`Skill "${wanted}" was not found`);
      return ok({ skill: skillToApi(skill) });
    },
  };
}

export function createCreateSkillTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'CreateSkill',
    description: CREATE_DESCRIPTION,
    schema: {
      label: z.string().describe('Short single-line label; unique among this account’s skills'),
      description: z.string().describe('When the agent should use this skill'),
      content: z
        .string()
        .describe('Full instructions the agent should follow after loading this skill'),
    },
    handler: async ({ label, description, content }) => {
      if (typeof label !== 'string') return fail('label is required');
      if (typeof description !== 'string') return fail('description is required');
      if (typeof content !== 'string') return fail('content is required');
      try {
        const skill = await app
          .service('skills')
          .create({ label, description, content }, skillParamsFor(userId));
        return ok({ skill: skillToApi(skill) });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

export function createUpdateSkillTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'UpdateSkill',
    description: UPDATE_DESCRIPTION,
    schema: {
      skill_id: z.number().int().optional().describe('Skill id from ListSkills'),
      label: z.string().optional().describe('Current label of the skill to update'),
      new_label: z.string().optional().describe('Replacement label (rename)'),
      description: z.string().optional().describe('Replacement description'),
      content: z.string().optional().describe('Replacement content'),
    },
    handler: async (params) => {
      const identifierErr = identifierError(params ?? {});
      if (identifierErr) return fail(identifierErr);

      const { skill_id, label, new_label, description, content } = params;
      const patch = {};
      if (new_label !== undefined) patch.label = new_label;
      if (description !== undefined) patch.description = description;
      if (content !== undefined) patch.content = content;
      if (Object.keys(patch).length === 0) {
        return fail('Include at least one of new_label, description, or content to change');
      }

      try {
        const skill = await findOwnSkill(app, userId, { skillId: skill_id, label });
        if (!skill) {
          return fail(`Skill was not found (skill_id: ${skill_id ?? '—'}, label: ${label ?? '—'})`);
        }
        const updated = await app.service('skills').patch(skill.id, patch, skillParamsFor(userId));
        return ok({ skill: skillToApi(updated) });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

export function createDeleteSkillTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'DeleteSkill',
    description: DELETE_DESCRIPTION,
    schema: {
      skill_id: z.number().int().optional().describe('Skill id from ListSkills'),
      label: z.string().optional().describe('Label of the skill to delete'),
    },
    handler: async (params) => {
      const identifierErr = identifierError(params ?? {});
      if (identifierErr) return fail(identifierErr);

      const { skill_id, label } = params;
      try {
        const skill = await findOwnSkill(app, userId, { skillId: skill_id, label });
        if (!skill) {
          return fail(`Skill was not found (skill_id: ${skill_id ?? '—'}, label: ${label ?? '—'})`);
        }
        await app.service('skills').remove(skill.id, skillParamsFor(userId));
        return ok({ deleted: true, skill_id: skill.id, label: skill.label });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
