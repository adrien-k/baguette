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

/** Lightweight CPU, memory, disk, and usage snapshot for the navbar (polled often). */
export async function getNavbarSystemInformation(userId) {
  const since = new Date(Date.now() - MS_PER_24H).toISOString();
  const last24hCostUsd = await usageCostUsdSince(userId, since);
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
  };
}
