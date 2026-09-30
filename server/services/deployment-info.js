import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';

function clockTicksPerSecond() {
  return os.constants?.os?.SC_CLK_TCK ?? 100;
}

/** Git revision for the running Baguette build (`BAGUETTE_GIT_SHA` from image build, else local git). */
export function getRunningGitSha() {
  const fromEnv = process.env.BAGUETTE_GIT_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Seconds since PID 1 started inside a Docker container; null when not containerized. */
export function getContainerUptimeSeconds() {
  if (!fs.existsSync('/.dockerenv')) return null;
  try {
    const stat = fs.readFileSync('/proc/1/stat', 'utf8');
    const afterParen = stat.slice(stat.lastIndexOf(')') + 2);
    const fields = afterParen.split(' ');
    const starttime = Number(fields[19]);
    if (!Number.isFinite(starttime)) return null;
    const bootSec = Date.now() / 1000 - os.uptime();
    const startedSec = bootSec + starttime / clockTicksPerSecond();
    return Math.max(0, Math.floor(Date.now() / 1000 - startedSec));
  } catch {
    return null;
  }
}
