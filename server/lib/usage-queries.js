import {
  normalizeUsageAgentType,
  parseUsageAgentTypeFilter,
} from '../../shared/usage-agent-type.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_USAGE_DAYS = 30;
const USAGE_SEARCH_LIMIT = 50;
const UNKNOWN_MODEL_FILTER = '__unknown__';

function parseUsageDays(value) {
  const n = Number(value);
  return n === 7 || n === 30 || n === 90 ? n : DEFAULT_USAGE_DAYS;
}

function parseAgentConfigFilter(value) {
  if (!value) return null;
  if (value === '__none__') return '__none__';
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseModelFilter(value) {
  if (value == null || value === '') return null;
  return String(value);
}

/** @param {import('knex').Knex} db */
function usageQuery(
  db,
  {
    userId = null,
    repo = null,
    agentConfigId = null,
    agentType = null,
    model = null,
    days = DEFAULT_USAGE_DAYS,
  } = {}
) {
  const since = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  const q = db('usage').where('created_at', '>=', since);
  if (userId != null) q.where({ user_id: userId });
  if (repo === '__global__') q.where({ repo_full_name: '' });
  else if (repo) q.where({ repo_full_name: repo });
  if (agentConfigId === '__none__') q.whereNull('agent_config_id');
  else if (agentConfigId != null) q.where({ agent_config_id: agentConfigId });
  if (agentType === 'reviewer' || agentType === 'builder' || agentType === 'subagent') {
    q.where({ agent_type: agentType });
  }
  if (model === UNKNOWN_MODEL_FILTER) {
    q.where(function unknownModel() {
      this.whereNull('model').orWhere('model', '');
    });
  } else if (model) {
    q.where({ model });
  }
  return q;
}

/** @param {import('knex').Knex} db */
async function attachAgentConfigLabels(db, rows) {
  const ids = [...new Set(rows.map((r) => r.agent_config_id).filter((id) => id != null))];
  const byId = new Map();
  if (ids.length) {
    const configs = await db('agent_configs').whereIn('id', ids).select('id', 'label', 'sdk');
    for (const c of configs) byId.set(c.id, c);
  }
  return rows.map((r) => {
    const cfg = r.agent_config_id != null ? byId.get(r.agent_config_id) : null;
    return {
      ...r,
      agent_config_label: cfg?.label ?? null,
      agent_sdk: cfg?.sdk ?? r.agent_sdk ?? 'claude',
    };
  });
}

/** @param {import('knex').Knex} db */
async function attachUsernames(db, rows) {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((id) => id != null))];
  const byId = new Map();
  if (ids.length) {
    const users = await db('users').whereIn('id', ids).select('id', 'username');
    for (const u of users) byId.set(u.id, u.username || null);
  }
  return rows.map((r) => ({
    ...r,
    username: r.user_id != null ? (byId.get(r.user_id) ?? null) : null,
  }));
}

export function parseUsageFilters(data = {}, query = {}) {
  const src = { ...query, ...data };
  const days = parseUsageDays(src.days);
  const userIdRaw = src.user_id;
  const userId = userIdRaw != null && userIdRaw !== '' ? Number(userIdRaw) : null;
  const agentConfigId = parseAgentConfigFilter(src.agent_config_id);
  const searchRaw = src.q ?? src.query ?? '';
  const agentType = parseUsageAgentTypeFilter(src);
  return {
    days,
    userId: Number.isFinite(userId) ? userId : null,
    repo: src.repo || null,
    agentConfigId,
    agentType,
    model: parseModelFilter(src.model),
    search: String(searchRaw || '').trim(),
  };
}

/** Users with usage in the window; optional username substring search. */
export async function fetchUsageUsers(db, { days, search = '' } = {}) {
  const since = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  let q = db('usage as u')
    .innerJoin('users as usr', 'usr.id', 'u.user_id')
    .where('u.created_at', '>=', since);

  const term = String(search || '')
    .trim()
    .toLowerCase();
  if (term) {
    q = q.whereRaw('lower(usr.username) like ?', [`%${term}%`]);
  }

  const rows = await q
    .select('u.user_id')
    .max('usr.username as username')
    .count('* as usage_rows')
    .groupBy('u.user_id')
    .orderBy('username', 'asc')
    .limit(USAGE_SEARCH_LIMIT);

  return rows.map((r) => ({
    user_id: r.user_id,
    username: r.username || null,
    usage_rows: Number(r.usage_rows ?? 0),
  }));
}

/** Distinct models seen in usage over the window; optional model-id substring search. */
export async function fetchUsageModels(db, { days, search = '', userId } = {}) {
  const since = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  let q = db('usage').where('created_at', '>=', since);
  if (userId != null) q = q.where('user_id', userId);

  const term = String(search || '')
    .trim()
    .toLowerCase();
  if (term) {
    q = q.whereRaw("lower(coalesce(model, '')) like ?", [`%${term}%`]);
  }

  const rows = await q
    .select('model')
    .count('* as usage_rows')
    .groupBy('model')
    .orderBy('model', 'asc')
    .limit(USAGE_SEARCH_LIMIT);

  return rows.map((r) => ({
    model: r.model || '',
    usage_rows: Number(r.usage_rows ?? 0),
  }));
}

/** One row per (day, user, repo, agent_config_id, agent_type, model) over the requested window. */
export async function fetchUsageBreakdown(db, filters) {
  const rows = await usageQuery(db, filters)
    .select(
      db.raw('date(created_at) as day'),
      'user_id',
      'repo_full_name',
      'agent_config_id',
      db.raw('max(agent_sdk) as agent_sdk'),
      'agent_type',
      'model'
    )
    .sum('cost_usd as cost_usd')
    .sum('input_tokens as input_tokens')
    .sum('output_tokens as output_tokens')
    .sum('cache_read_tokens as cache_read_tokens')
    .sum('cache_write_tokens as cache_write_tokens')
    .sum('total_tokens as total_tokens')
    .groupByRaw('date(created_at), user_id, repo_full_name, agent_config_id, agent_type, model')
    .orderBy('day', 'asc');

  const mapped = rows.map((r) => ({
    day: r.day,
    user_id: r.user_id ?? null,
    repo_full_name: r.repo_full_name,
    agent_config_id: r.agent_config_id ?? null,
    agent_sdk: r.agent_sdk || 'claude',
    agent_type: normalizeUsageAgentType(r.agent_type),
    model: r.model || '',
    cost_usd: parseFloat(r.cost_usd),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
    cache_read_tokens: Number(r.cache_read_tokens ?? 0),
    cache_write_tokens: Number(r.cache_write_tokens ?? 0),
    total_tokens: Number(r.total_tokens ?? 0),
  }));

  const withUsers = await attachUsernames(db, mapped);
  return attachAgentConfigLabels(db, withUsers);
}

/** Distinct agent configurations seen in usage over the window. */
export async function fetchUsageAgentConfigs(db, { days, userId }) {
  const since = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  let q = db('usage as u')
    .leftJoin('agent_configs as c', 'c.id', 'u.agent_config_id')
    .where('u.created_at', '>=', since);
  if (userId != null) q = q.where('u.user_id', userId);

  const rows = await q
    .select('u.agent_config_id')
    .max('c.label as label')
    .max('c.sdk as sdk')
    .count('* as usage_rows')
    .groupBy('u.agent_config_id')
    .orderBy('label', 'asc');

  return rows.map((r) => ({
    agent_config_id: r.agent_config_id ?? null,
    label:
      r.agent_config_id == null
        ? 'Unknown configuration'
        : r.label || `Config ${r.agent_config_id}`,
    sdk: r.sdk || null,
    usage_rows: Number(r.usage_rows ?? 0),
  }));
}
