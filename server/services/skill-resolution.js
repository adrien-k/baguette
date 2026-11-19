import { resolveDataDirRelativePath } from '../config.js';
import { loadBuiltinSkills } from './builtin-skills.js';
import { loadProjectSkills } from './project-skills.js';

export const AUTO_LOAD_SKILLS_MAX = 20;

export function parseAutoLoadSkillLabels(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, AUTO_LOAD_SKILLS_MAX);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, AUTO_LOAD_SKILLS_MAX);
  } catch {
    return [];
  }
}

export function serializeAutoLoadSkillLabels(labels) {
  const list = parseAutoLoadSkillLabels(labels);
  if (!list.length) return null;
  return JSON.stringify(list);
}

/**
 * Before serializeAutoLoadSkills on create: fill missing auto_load_skills from the user row.
 * Loop-spawned sessions (`loop_id` set) skip this — they only use skills stored on the loop.
 */
export async function applyUserDefaultAutoLoadSkillsOnCreate(context) {
  if (context.method !== 'create') return context;
  if (context.data.loop_id != null) return context;
  if ('auto_load_skills' in context.data) return context;
  const userId = context.params?.user?.id ?? context.data?.user_id;
  if (userId == null) return context;
  const row = await context.app
    .get('db')('users')
    .where({ id: userId })
    .select('default_auto_load_skills')
    .first();
  const labels = parseAutoLoadSkillLabels(row?.default_auto_load_skills);
  if (labels.length) context.data.auto_load_skills = labels;
  return context;
}

async function skillsForUser(app, userId) {
  const rows = await app.service('skills').find({
    user: { id: userId },
    paginate: false,
  });
  return Array.isArray(rows) ? rows : (rows?.data ?? []);
}

function sessionPathFromContext(callerSession, repoPath) {
  if (callerSession) {
    const direct =
      callerSession.absolute_session_path || resolveDataDirRelativePath(callerSession.session_path);
    if (direct) return direct;
  }
  if (repoPath) return resolveDataDirRelativePath(repoPath) || repoPath;
  return null;
}

/**
 * List skills for MCP ListSkills / dashboard catalog (settings, project, builtin).
 */
export async function listSkillEntries(
  app,
  userId,
  { callerSession = null, repoPath = null } = {}
) {
  const rows = await skillsForUser(app, userId);
  const settingsEntries = rows.map((skill) => ({
    id: skill.id,
    label: skill.label,
    description: skill.description,
    source: 'settings',
  }));
  const settingsLabels = new Set(settingsEntries.map((s) => s.label));

  const sessionPath = sessionPathFromContext(callerSession, repoPath);
  const projectRows = sessionPath ? await loadProjectSkills(sessionPath) : [];
  const projectEntries = projectRows
    .filter((skill) => !settingsLabels.has(skill.label))
    .map((skill) => ({
      label: skill.label,
      description: skill.description,
      source: 'project',
      rel_path: skill.rel_path,
    }));

  const coveredLabels = new Set([...settingsLabels, ...projectEntries.map((s) => s.label)]);

  const builtinRows = await loadBuiltinSkills();
  const builtinEntries = builtinRows
    .filter((skill) => !coveredLabels.has(skill.label))
    .map((skill) => ({
      label: skill.label,
      description: skill.description,
      source: 'builtin',
      builtin_id: skill.builtin_id,
    }));

  return [...settingsEntries, ...projectEntries, ...builtinEntries].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
}

export async function readSkillByLabel(app, userId, { sessionPath = null, label }) {
  const wanted = String(label ?? '').trim();
  if (!wanted) return null;

  const rows = await skillsForUser(app, userId);
  const settingsSkill = rows.find((row) => row.label === wanted);
  if (settingsSkill) {
    return {
      id: settingsSkill.id,
      label: settingsSkill.label,
      description: settingsSkill.description,
      content: settingsSkill.content,
      source: 'settings',
    };
  }

  if (sessionPath) {
    const projectRows = await loadProjectSkills(sessionPath);
    const projectSkill = projectRows.find((row) => row.label === wanted);
    if (projectSkill) {
      return {
        label: projectSkill.label,
        description: projectSkill.description,
        content: projectSkill.content,
        source: 'project',
        rel_path: projectSkill.rel_path,
      };
    }
  }

  const builtinRows = await loadBuiltinSkills();
  const builtinSkill = builtinRows.find((row) => row.label === wanted);
  if (!builtinSkill) return null;
  return {
    label: builtinSkill.label,
    description: builtinSkill.description,
    content: builtinSkill.content,
    source: 'builtin',
    builtin_id: builtinSkill.builtin_id,
  };
}

/**
 * Markdown block appended to the builder/subagent system prompt.
 */
export async function buildPreloadedSkillsPrompt(app, sessionRow, labels) {
  const wanted = parseAutoLoadSkillLabels(labels);
  if (!wanted.length || !sessionRow?.user_id) return '';

  const sessionPath =
    sessionRow.absolute_session_path || resolveDataDirRelativePath(sessionRow.session_path) || null;

  const sections = [];
  for (const label of wanted) {
    const skill = await readSkillByLabel(app, sessionRow.user_id, { sessionPath, label });
    if (!skill?.content) continue;
    sections.push(`### ${skill.label}\n\n${skill.content}`);
  }
  if (!sections.length) return '';

  return [
    '## Preloaded skills',
    '',
    'These skills were selected when this session (or its loop) was created. Follow them alongside the rest of the system prompt.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}
