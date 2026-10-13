import { describe, it, expect, vi } from 'vitest';
import { createPlanHandlers } from '../mcp/lib/plan-handlers.js';

function parseHandlerResult(result) {
  return JSON.parse(result.content[0].text);
}

function makeApp(planRow) {
  const find = vi.fn().mockResolvedValue(planRow ? [planRow] : []);
  const create = vi.fn();
  const patch = vi.fn();
  return {
    app: {
      service: (name) => {
        if (name !== 'session-plans') throw new Error(`unexpected service ${name}`);
        return { find, create, patch };
      },
    },
    find,
    create,
    patch,
  };
}

describe('createPlanHandlers.readPlan', () => {
  it('returns markdown when a plan exists', async () => {
    const { app } = makeApp({ id: 3, markdown: '# Plan\n\nStep one.' });
    const h = createPlanHandlers({ id: 1, user_id: 9 }, app);
    const out = parseHandlerResult(await h.readPlan());
    expect(out).toEqual({ ok: true, markdown: '# Plan\n\nStep one.' });
  });

  it('fails when no plan exists', async () => {
    const { app } = makeApp(null);
    const h = createPlanHandlers({ id: 1, user_id: 9 }, app);
    const out = parseHandlerResult(await h.readPlan());
    expect(out).toEqual({
      ok: false,
      error: 'No plan exists for this session; call CreatePlan first',
    });
  });
});

describe('createPlanHandlers.editPlan', () => {
  it('rejects when no plan exists', async () => {
    const { app } = makeApp(null);
    const h = createPlanHandlers({ id: 1, user_id: 9 }, app);
    const out = parseHandlerResult(
      await h.editPlan({ patches: [{ old_string: 'x', new_string: 'y' }] })
    );
    expect(out).toEqual({
      ok: false,
      error: 'No plan exists for this session; call CreatePlan first',
    });
  });
});
