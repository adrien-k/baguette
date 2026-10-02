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

export const ACTIVE_AGENT_STATUSES = ['running', 'provisioning', 'archiving'];

const ACTIVE_SESSION_COLUMNS = [
  'id',
  'short_id',
  'label',
  'repo_full_name',
  'status',
  'review_status',
  'agent_sdk',
  'model',
  'model_params',
  'review_agent_sdk',
  'review_model',
  'review_model_params',
];

function sessionAgentRow(row, kind) {
  const isReview = kind === 'review';
  return {
    session_id: row.id,
    short_id: row.short_id,
    label: row.label,
    repo_full_name: row.repo_full_name ?? '',
    kind,
    agent_sdk: isReview ? (row.review_agent_sdk ?? row.agent_sdk) : row.agent_sdk,
    model: isReview ? (row.review_model ?? row.model) : row.model,
    model_params: isReview ? (row.review_model_params ?? row.model_params) : row.model_params,
  };
}

/** Running chat and review agents for the signed-in user (Usage page + ops). */
export async function getActiveAgents(userId) {
  const rows = await db('sessions')
    .where({ user_id: userId })
    .whereNull('archived_at')
    .where((qb) => {
      qb.whereIn('status', ACTIVE_AGENT_STATUSES).orWhere('review_status', 'running');
    })
    .select(ACTIVE_SESSION_COLUMNS);

  const agents = [];
  for (const row of rows) {
    if (ACTIVE_AGENT_STATUSES.includes(row.status)) {
      agents.push(sessionAgentRow(row, 'chat'));
    }
    if (row.review_status === 'running') {
      agents.push(sessionAgentRow(row, 'review'));
    }
  }

  agents.sort((a, b) => {
    const labelA = a.label || a.short_id || '';
    const labelB = b.label || b.short_id || '';
    return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
  });
  return agents;
}

async function runningSessionCounts(userId) {
  const base = () => db('sessions').where({ user_id: userId }).whereNull('archived_at');
  const [agentsRow, reviewersRow] = await Promise.all([
    base().whereIn('status', ACTIVE_AGENT_STATUSES).count('* as count').first(),
    base().where('review_status', 'running').count('* as count').first(),
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
