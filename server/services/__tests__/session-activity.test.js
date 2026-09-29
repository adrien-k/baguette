import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionReviewMessagesService } from '../feathers/session-review-messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { DEBOUNCE_DELAY_MS } from '../session-activity.js';

const db = createTestDb({ beforeEach, afterEach });

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerMessagesService(app);
  registerSessionsService(app);
  registerSessionReviewMessagesService(app);
  app.use(
    'claude-agent',
    { syncSessionSettingsFromPatch: async () => {}, onMessageCreated: async () => {} },
    { methods: ['syncSessionSettingsFromPatch', 'onMessageCreated'] }
  );
  return app;
}

describe('session last_activity_at from messages', () => {
  it('DEBOUNCE_DELAY_MS is 5s', () => {
    expect(DEBOUNCE_DELAY_MS).toBe(5000);
  });

  it('debounces activity bumps per session id', async () => {
    vi.useFakeTimers();
    try {
      const app = makeApp(db);
      await app.setup();
      const sessions = app.service('sessions');
      sessions.registerActivityMessageListeners(app);
      const onActivity = vi.spyOn(sessions, 'onActivity').mockResolvedValue();

      sessions._bumpLastActivityOnMessageCreated({ session_id: 1 });
      sessions._bumpLastActivityOnMessageCreated({ session_id: 1 });
      expect(onActivity).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY_MS);
      sessions._bumpLastActivityOnMessageCreated({ session_id: 1 });
      expect(onActivity).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('onActivity patches last_activity_at', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
    try {
      const [userId] = await db('users').insert({ github_id: 9, username: 'act', approved: true });
      const [sessionId] = await db('sessions').insert({
        user_id: userId,
        repo_full_name: 'o/r',
        base_branch: 'main',
        initial_prompt: 't',
        short_id: 'actses',
        status: 'stopped',
        last_activity_at: '2026-01-01T00:00:00.000Z',
      });
      const app = makeApp(db);
      await app.setup();
      await app.service('sessions').onActivity(sessionId);
      const after = await db('sessions').where({ id: sessionId }).first();
      expect(after.last_activity_at).toBe('2026-09-29T12:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
