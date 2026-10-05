/**
 * Session-scoped progress for long-running backfill scripts (stderr, TTY-aware).
 * @param {string} label
 * @param {number} total
 */
export function createSessionProgress(label, total) {
  let done = 0;
  let lastPct = -1;
  const isTty = process.stderr.isTTY;

  const render = (force = false) => {
    if (total === 0) {
      if (lastPct < 0) {
        console.log(`${label}: 100% (0/0 sessions)`);
        lastPct = 100;
      }
      return;
    }
    const pct = Math.min(100, Math.floor((done / total) * 100));
    if (!force && pct === lastPct && done < total) return;
    lastPct = pct;
    const line = `${label}: ${pct}% (${done}/${total} sessions)`;
    if (isTty) {
      process.stderr.write(`\r${line}`);
      if (done >= total) process.stderr.write('\n');
    } else {
      console.log(line);
    }
  };

  return {
    sessionDone() {
      done += 1;
      render(done >= total);
    },
    done() {
      render(true);
    },
  };
}
