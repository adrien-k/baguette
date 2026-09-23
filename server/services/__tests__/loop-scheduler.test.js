import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { LoopScheduler } from '../loop-scheduler.js';

describe('LoopScheduler', () => {
  let app;
  let queuedRunDue;
  let loopsRunDue;

  beforeEach(() => {
    app = feathers();
    queuedRunDue = vi.fn().mockResolvedValue(undefined);
    loopsRunDue = vi.fn().mockResolvedValue(undefined);
    app.use('queued-messages', { runDue: queuedRunDue }, { methods: ['runDue'] });
    app.use('loops', { runDue: loopsRunDue }, { methods: ['runDue'] });
  });

  it('tick dispatches scheduled queued messages before running due loops', async () => {
    const scheduler = new LoopScheduler(app);
    const order = [];

    queuedRunDue.mockImplementation(async () => {
      order.push('queued-messages');
    });
    loopsRunDue.mockImplementation(async () => {
      order.push('loops');
    });

    await scheduler.tick();

    expect(order).toEqual(['queued-messages', 'loops']);
  });
});
