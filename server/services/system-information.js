import fs from 'fs';
import os from 'os';

import { DATA_DIR } from '../config.js';
import db from '../db.js';
import { getContainerUptimeSeconds, getRunningGitSha } from './deployment-info.js';

const MS_PER_24H = 24 * 60 * 60 * 1000;

function diskStatsForPath(targetPath) {
  const stat = fs.statfsSync(targetPath);
  const bsize = Number(stat.bsize);
  return {
    path: targetPath,
    totalBytes: bsize * Number(stat.blocks),
    freeBytes: bsize * Number(stat.bfree),
    availableBytes: bsize * Number(stat.bavail),
  };
}

function hostResourceSnapshot() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    cpu: {
      count: cpus.length,
      model: cpus[0]?.model ?? 'Unknown',
      speedMhz: cpus[0]?.speed ?? null,
    },
    loadAvg: os.loadavg(),
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: totalMem - freeMem,
    },
    disk: diskStatsForPath(DATA_DIR),
  };
}

/** Full host and deployment details for the System settings page. */
export function getSystemInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: os.uptime(),
    ...hostResourceSnapshot(),
    gitSha: getRunningGitSha(),
    containerUptimeSeconds: getContainerUptimeSeconds(),
  };
}

async function usageCostUsdSince(userId, sinceIso) {
  const row = await db('usage')
    .where({ user_id: userId })
    .where('created_at', '>=', sinceIso)
    .sum('cost_usd as cost_usd')
    .first();
  return parseFloat(row?.cost_usd ?? 0) || 0;
}

const RUNNING_TURN_STATUSES = ['running', 'approval'];

function sessionAgentRow(row) {
  const isReview = row.agent_type === 'reviewer';
  return {
    session_id: row.session_id,
    short_id: row.short_id,
    user_id: row.user_id,
    username: row.username ?? null,
    label: row.label,
    repo_full_name: row.repo_full_name ?? '',
    agent_type: isReview ? 'reviewer' : 'builder',
    agent_sdk: row.agent_sdk,
    model: row.model,
    model_params: row.model_params,
  };
}

/** Running chat and review agents (all users, or one user when `userId` is set). */
export async function getActiveAgents(userId = null, knex = db) {
  const q = knex('agents')
    .join('sessions', 'sessions.id', 'agents.session_id')
    .leftJoin('users', 'users.id', 'sessions.user_id')
    .whereIn('agents.status', RUNNING_TURN_STATUSES)
    .whereNull('sessions.archived_at')
    .select(
      'agents.agent_type',
      'agents.agent_sdk',
      'agents.model',
      'agents.model_params',
      'sessions.id as session_id',
      'sessions.short_id',
      'sessions.label',
      'sessions.repo_full_name',
      'sessions.user_id',
      'users.username'
    );
  if (userId != null) q.where('sessions.user_id', userId);
  const rows = await q;
  const agents = rows.map(sessionAgentRow);
  agents.sort((a, b) => {
    const labelA = a.label || a.short_id || '';
    const labelB = b.label || b.short_id || '';
    return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
  });
  return agents;
}

async function runningSessionCounts(userId) {
  const base = () =>
    db('agents')
      .join('sessions', 'sessions.id', 'agents.session_id')
      .where('sessions.user_id', userId)
      .whereNull('sessions.archived_at')
      .whereIn('agents.status', RUNNING_TURN_STATUSES);
  const [agentsRow, reviewersRow] = await Promise.all([
    base().where('agents.is_primary', 1).count('* as count').first(),
    base().where('agents.agent_type', 'reviewer').count('* as count').first(),
  ]);
  return {
    running_agents: Number(agentsRow?.count ?? 0),
    running_reviewers: Number(reviewersRow?.count ?? 0),
  };
}

/** Lightweight CPU, memory, disk, and usage snapshot for the navbar (polled often). */
export async function getNavbarSystemInformation(userId) {
  const since = new Date(Date.now() - MS_PER_24H).toISOString();
  const [last24hCostUsd, sessionCounts] = await Promise.all([
    usageCostUsdSince(userId, since),
    runningSessionCounts(userId),
  ]);
  const { cpu, loadAvg, memory, disk } = hostResourceSnapshot();
  return {
    cpu: { count: cpu.count },
    loadAvg,
    memory: {
      totalBytes: memory.totalBytes,
      usedBytes: memory.usedBytes,
    },
    disk: {
      totalBytes: disk.totalBytes,
      availableBytes: disk.availableBytes,
    },
    usage: {
      last_24h_cost_usd: last24hCostUsd,
    },
    sessions: sessionCounts,
  };
}
