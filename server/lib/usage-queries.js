const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_USAGE_DAYS = 30;

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

/** @param {import('knex').Knex} db */
function usageQuery(
  db,
  { userId = null, repo = null, agentConfigId = null, kind = null, days = DEFAULT_USAGE_DAYS } = {}
) {
  const since = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  const q = db('usage').where('created_at', '>=', since);
  if (userId != null) q.where({ user_id: userId });
  if (repo === '__global__') q.where({ repo_full_name: '' });
  else if (repo) q.where({ repo_full_name: repo });
  if (agentConfigId === '__none__') q.whereNull('agent_config_id');
  else if (agentConfigId != null) q.where({ agent_config_id: agentConfigId });
  if (kind === 'review') q.where({ kind: 'review' });
  else if (kind === 'session') {
    q.where((b) => b.whereNull('kind').orWhere('kind', '<>', 'review'));
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

export function parseUsageFilters(data = {}, query = {}) {
  const src = { ...query, ...data };
  const days = parseUsageDays(src.days);
  const userIdRaw = src.user_id;
  const userId = userIdRaw != null && userIdRaw !== '' ? Number(userIdRaw) : null;
  const agentConfigId = parseAgentConfigFilter(src.agent_config_id);
  const searchRaw = src.q ?? src.query ?? '';
  return {
    days,
    userId: Number.isFinite(userId) ? userId : null,
    repo: src.repo || null,
    agentConfigId,
    kind: src.kind || null,
    search: String(searchRaw || '').trim(),
  };
}

const USAGE_USER_SEARCH_LIMIT = 50;

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
    .limit(USAGE_USER_SEARCH_LIMIT);

  return rows.map((r) => ({
    user_id: r.user_id,
    username: r.username || null,
    usage_rows: Number(r.usage_rows ?? 0),
  }));
}

/** One row per (day, repo, agent_config_id, kind, model) over the requested window. */
export async function fetchUsageBreakdown(db, filters) {
  const rows = await usageQuery(db, filters)
    .select(
      db.raw('date(created_at) as day'),
      'repo_full_name',
      'agent_config_id',
      db.raw('max(agent_sdk) as agent_sdk'),
      db.raw("CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END as usage_kind"),
      'model'
    )
    .sum('cost_usd as cost_usd')
    .sum('input_tokens as input_tokens')
    .sum('output_tokens as output_tokens')
    .sum('cache_read_tokens as cache_read_tokens')
    .sum('cache_write_tokens as cache_write_tokens')
    .sum('total_tokens as total_tokens')
    .groupByRaw(
      "date(created_at), repo_full_name, agent_config_id, CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END, model"
    )
    .orderBy('day', 'asc');

  const mapped = rows.map((r) => ({
    day: r.day,
    repo_full_name: r.repo_full_name,
    agent_config_id: r.agent_config_id ?? null,
    agent_sdk: r.agent_sdk || 'claude',
    kind: r.usage_kind === 'review' ? 'review' : 'session',
    model: r.model || '',
    cost_usd: parseFloat(r.cost_usd),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
    cache_read_tokens: Number(r.cache_read_tokens ?? 0),
    cache_write_tokens: Number(r.cache_write_tokens ?? 0),
    total_tokens: Number(r.total_tokens ?? 0),
  }));

  return attachAgentConfigLabels(db, mapped);
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
