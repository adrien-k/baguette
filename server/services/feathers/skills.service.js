import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from 'feathers/errors';
import { resolveDataDirRelativePath } from '../../config.js';
import { listSkillEntries, readSkillByLabel } from '../skill-resolution.js';
import { requireUser, scopeByUser, only } from './hooks.js';

const LABEL_MAX = 120;
const DESCRIPTION_MAX = 2000;
const CONTENT_MAX = 200_000;
const WRITABLE = ['label', 'description', 'content'];

class SkillsService extends KnexService {
  setup(app) {
    this.app = app;
  }

  /** Skills available in the dashboard (settings + builtin + optional repo `.baguette/skills`). */
  async listCatalog(data, params) {
    const userId = params.user?.id;
    if (userId == null) throw new BadRequest('Not authenticated');
    let repoPath = null;
    const repoId = data?.repo_id;
    if (repoId != null) {
      const repo = await this.app.get('db')('repos').where({ id: repoId }).first();
      if (repo) repoPath = resolveDataDirRelativePath(repo.repo_path) || repo.repo_path;
    }
    const skills = await listSkillEntries(this.app, userId, { repoPath });
    return { skills };
  }

  /** Load full skill body by label (settings, project, or built-in). */
  async readByLabel(data, params) {
    const userId = params.user?.id;
    if (userId == null) throw new BadRequest('Not authenticated');
    const label = String(data?.label ?? '').trim();
    if (!label) throw new BadRequest('label is required');
    let sessionPath = null;
    const repoId = data?.repo_id;
    if (repoId != null) {
      const repo = await this.app.get('db')('repos').where({ id: repoId }).first();
      if (repo) {
        sessionPath = resolveDataDirRelativePath(repo.repo_path) || repo.repo_path;
      }
    }
    const skill = await readSkillByLabel(this.app, userId, { sessionPath, label });
    if (!skill) throw new NotFound('Skill not found');
    return skill;
  }
}

function requireText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text) throw new BadRequest(`${field} is required`);
  if (text.length > max) throw new BadRequest(`${field} is too long`);
  return text;
}

function normalizeSkillFields(data, { partial }) {
  const out = {};
  const include = (key) => !partial || data[key] !== undefined;

  if (include('label')) {
    const label = requireText(data.label, 'label', LABEL_MAX);
    if (/[\r\n]/.test(label)) throw new BadRequest('label must be a single line');
    out.label = label;
  }
  if (include('description')) {
    out.description = requireText(data.description, 'description', DESCRIPTION_MAX);
  }
  if (include('content')) {
    out.content = requireText(data.content, 'content', CONTENT_MAX);
  }
  return out;
}

async function beforeCreate(context) {
  const userId = context.params.user?.id;
  if (userId == null) throw new BadRequest('Not authenticated');
  const fields = normalizeSkillFields(context.data ?? {}, { partial: false });
  const now = new Date().toISOString();
  context.data = {
    user_id: userId,
    ...fields,
    created_at: now,
    updated_at: now,
  };
  return context;
}

async function beforePatch(context) {
  const fields = normalizeSkillFields(context.data ?? {}, { partial: true });
  context.data = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  return context;
}

async function assertUniqueLabel(context) {
  const label = context.data?.label;
  const userId = context.params.user?.id ?? context.data?.user_id;
  if (!label || userId == null) return context;
  const existing = await context.app.get('db')('skills').where({ user_id: userId, label }).first();
  if (existing && String(existing.id) !== String(context.id ?? '')) {
    throw new BadRequest('A skill with this label already exists');
  }
  return context;
}

async function requireOwnSkill(context) {
  const userId = context.params.user?.id;
  if (userId == null) throw new BadRequest('Not authenticated');
  const row = await context.app
    .get('db')('skills')
    .where({ id: context.id, user_id: userId })
    .first();
  if (!row) throw new NotFound('Skill not found');
  delete context.params.knex;
  return context;
}

export function registerSkillsService(app, path = 'skills') {
  app.use(
    path,
    new SkillsService({
      Model: app.get('db'),
      name: 'skills',
      id: 'id',
      paginate: false,
    }),
    { methods: ['find', 'get', 'create', 'patch', 'remove', 'listCatalog', 'readByLabel'] }
  );
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeByUser],
      listCatalog: [requireUser],
      readByLabel: [requireUser],
      create: [only(WRITABLE), beforeCreate, assertUniqueLabel],
      patch: [requireOwnSkill, only(WRITABLE), beforePatch, assertUniqueLabel],
      remove: [requireOwnSkill],
    },
  });
}
