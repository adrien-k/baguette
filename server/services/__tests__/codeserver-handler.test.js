import { describe, it, expect } from 'vitest';
import { CodeServerHandler } from '../codeserver-handler.js';

describe('CodeServerHandler.allowUser', () => {
  /** Minimal db/app stand-in: db('users').where({id}).first() resolves from usersById. */
  function handlerFor(usersById) {
    const db = () => ({
      where: (clause) => ({
        first: () => Promise.resolve(usersById[clause.id] ?? null),
      }),
    });
    const app = { get: () => db };
    return new CodeServerHandler(app, { headers: { host: 'code.example.com' } });
  }

  it('allows an existing approved user', async () => {
    const handler = handlerFor({ 3: { id: 3, approved: 1 } });
    await expect(handler.allowUser('3')).resolves.toBe(true);
  });

  it('rejects a pending (unapproved) user', async () => {
    const handler = handlerFor({ 3: { id: 3, approved: 0 } });
    await expect(handler.allowUser('3')).resolves.toBe(false);
  });

  it('rejects anonymous requests', async () => {
    const handler = handlerFor({ 3: { id: 3, approved: 1 } });
    await expect(handler.allowUser(null)).resolves.toBe(false);
    await expect(handler.allowUser('')).resolves.toBe(false);
    await expect(handler.allowUser(undefined)).resolves.toBe(false);
  });

  it('rejects unknown user ids', async () => {
    const handler = handlerFor({});
    await expect(handler.allowUser('3')).resolves.toBe(false);
  });
});
