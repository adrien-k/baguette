import { z } from 'zod';
import { fail, ok } from '../lib/result.js';

const LIST_DESCRIPTION =
  'List skills saved on this account (Settings → Skills). Returns id, label, and description only — call ReadSkill with the label to load the content. Skills are not included in the prompt.';

const READ_DESCRIPTION =
  'Load one skill by the exact label from ListSkills. Returns the label, description, and full content. Use this when a skill description matches the task, then follow that content.';

async function skillsForUser(app, userId) {
  const rows = await app.service('skills').find({
    user: { id: userId },
    paginate: false,
  });
  return Array.isArray(rows) ? rows : (rows?.data ?? []);
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
      return ok({
        skill: {
          id: skill.id,
          label: skill.label,
          description: skill.description,
          content: skill.content,
        },
      });
    },
  };
}
