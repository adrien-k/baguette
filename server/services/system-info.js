import fs from 'fs';
import os from 'os';

import { DATA_DIR } from '../config.js';

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
export function getSystemInfo() {
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
