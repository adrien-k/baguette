import fs from 'fs';
import os from 'os';

import { DATA_DIR } from '../config.js';
import db from '../db.js';

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

/** Host CPU, memory, and disk usage for the Baguette data directory. */
export function getHostMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: os.uptime(),
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

async function usageCostUsdSince(userId, sinceIso) {
  const row = await db('usage')
    .where({ user_id: userId })
    .where('created_at', '>=', sinceIso)
    .sum('cost_usd as cost_usd')
    .first();
  return parseFloat(row?.cost_usd ?? 0) || 0;
}

/** Host metrics plus signed-in user usage for navbar / system pages. */
export async function getLiveMetrics(userId) {
  const since = new Date(Date.now() - MS_PER_24H).toISOString();
  const last24hCostUsd = await usageCostUsdSince(userId, since);
  return {
    ...getHostMetrics(),
    usage: {
      last_24h_cost_usd: last24hCostUsd,
    },
  };
}
