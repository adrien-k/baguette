import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from 'feathers/errors';
import { requireUser, scopeByUser, only } from './hooks.js';

const LABEL_MAX = 120;
const DESCRIPTION_MAX = 2000;
const CONTENT_MAX = 200_000;
const WRITABLE = ['label', 'description', 'content'];

class SkillsService extends KnexService {}

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
    { methods: ['find', 'get', 'create', 'patch', 'remove'] }
  );
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeByUser],
      create: [only(WRITABLE), beforeCreate, assertUniqueLabel],
      patch: [requireOwnSkill, only(WRITABLE), beforePatch, assertUniqueLabel],
      remove: [requireOwnSkill],
    },
  });
}
