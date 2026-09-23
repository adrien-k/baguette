import logger from '../logger.js';

/** How often we look for due loops and scheduled queued messages. */
export const LOOP_TICK_MS = 30_000;

/**
 * Single periodic tick for time-based background work: recurring loops and scheduled chat messages.
 *
 * Kept deliberately thin: DB reads/writes and side effects live in Feathers services, so this
 * module only owns the clock (and never overlaps ticks).
 */
export class LoopScheduler {
  constructor(app, { intervalMs = LOOP_TICK_MS } = {}) {
    this.app = app;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Do not hold the process open just for the scheduler.
    this.timer.unref?.();
    logger.info({ intervalMs: this.intervalMs }, 'Loop scheduler started');
    void this.tick();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    // A tick that runs long (several loops each booting an agent) must not stack up.
    if (this.running) return;
    this.running = true;
    try {
      await this.app.service('queued-messages').runDue();
      await this.app.service('loops').runDue();
    } catch (err) {
      logger.error({ err }, 'Loop scheduler tick failed');
    } finally {
      this.running = false;
    }
  }
}
