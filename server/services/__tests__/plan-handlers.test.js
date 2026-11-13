import { describe, it, expect } from 'vitest';
import { createPlanHandlers } from '../mcp/lib/plan-handlers.js';

function parseHandlerResult(result) {
  return JSON.parse(result.content[0].text);
}

function makeApp({ plans = [], agents = [] } = {}) {
  const planStore = plans.map((p) => ({ ...p }));
  const agentStore = agents.map((a) => ({ ...a }));
  let nextPlanId = Math.max(0, ...planStore.map((p) => p.id || 0)) + 1;

  const sessionPlans = {
    async find({ query }) {
      let rows = planStore.filter((p) => p.session_id === query.session_id);
      if (query.id != null) rows = rows.filter((p) => p.id === query.id);
      if (query.ref != null) rows = rows.filter((p) => p.ref === query.ref);
      if (query.status != null) rows = rows.filter((p) => p.status === query.status);
      const limit = query.$limit ?? rows.length;
      return rows.slice(0, limit);
    },
    async create(data) {
      const sessionRows = planStore.filter((p) => p.session_id === data.session_id);
      const ref = Math.max(0, ...sessionRows.map((p) => p.ref || 0)) + 1;
      const row = {
        id: nextPlanId++,
        session_id: data.session_id,
        markdown: data.markdown,
        ref,
        status: data.status ?? 'open',
      };
      planStore.push(row);
      return row;
    },
    async patch(id, data) {
      const row = planStore.find((p) => p.id === id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      if (data.status === 'completed') {
        for (const agent of agentStore) {
          if (agent.current_plan_id === row.id) agent.current_plan_id = null;
        }
      }
      return row;
    },
  };

  const agentsService = {
    async find({ query }) {
      let rows = [...agentStore];
      if (query.current_plan_id !== undefined) {
        rows = rows.filter((a) => a.current_plan_id === query.current_plan_id);
      }
      return rows;
    },
    async patch(id, data) {
      const row = agentStore.find((a) => a.id === id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  return {
    app: {
      service: (name) => {
        if (name === 'session-plans') return sessionPlans;
        if (name === 'agents') return agentsService;
        throw new Error(`unexpected service ${name}`);
      },
    },
    planStore,
    agentStore,
  };
}

const session = { id: 1, user_id: 9 };

describe('createPlanHandlers.createPlan', () => {
  it('inserts a new row each time and does not attach the calling agent', async () => {
    const callerAgent = { id: 20, current_plan_id: null };
    const { app, agentStore } = makeApp({ agents: [callerAgent] });
    const h = createPlanHandlers(session, app, { callerAgent });

    const first = parseHandlerResult(await h.createPlan({ markdown: '# One' }));
    expect(first).toMatchObject({
      ok: true,
      id: 1,
      ref: 1,
      status: 'open',
      markdown: '# One',
    });

    const second = parseHandlerResult(await h.createPlan({ markdown: '# Two' }));
    expect(second).toMatchObject({
      ok: true,
      id: 2,
      ref: 2,
      status: 'open',
      markdown: '# Two',
    });

    expect(callerAgent.current_plan_id).toBeNull();
    expect(agentStore[0].current_plan_id).toBeNull();
  });
});

describe('createPlanHandlers.startPlan', () => {
  it('sets current_plan_id on the calling agent', async () => {
    const callerAgent = { id: 20, current_plan_id: null };
    const { app, agentStore } = makeApp({
      plans: [{ id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# Plan' }],
      agents: [callerAgent],
    });
    const h = createPlanHandlers(session, app, { callerAgent });
    const out = parseHandlerResult(await h.startPlan({ plan_id: 3 }));
    expect(out).toMatchObject({ ok: true, id: 3, current_plan_id: 3 });
    expect(callerAgent.current_plan_id).toBe(3);
    expect(agentStore[0].current_plan_id).toBe(3);
  });

  it('is idempotent when already on that plan and can switch without completing the previous', async () => {
    const callerAgent = { id: 20, current_plan_id: 3 };
    const { app, planStore } = makeApp({
      plans: [
        { id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# A' },
        { id: 4, session_id: 1, ref: 2, status: 'open', markdown: '# B' },
      ],
      agents: [callerAgent],
    });
    const h = createPlanHandlers(session, app, { callerAgent });

    const same = parseHandlerResult(await h.startPlan({ ref: 1 }));
    expect(same.ok).toBe(true);
    expect(callerAgent.current_plan_id).toBe(3);

    const switched = parseHandlerResult(await h.startPlan({ plan_id: 4 }));
    expect(switched).toMatchObject({ ok: true, id: 4, current_plan_id: 4 });
    expect(callerAgent.current_plan_id).toBe(4);
    expect(planStore.find((p) => p.id === 3).status).toBe('open');
  });

  it('fails if the plan is missing or completed', async () => {
    const callerAgent = { id: 20, current_plan_id: null };
    const { app } = makeApp({
      plans: [{ id: 5, session_id: 1, ref: 1, status: 'completed', markdown: '# Done' }],
      agents: [callerAgent],
    });
    const h = createPlanHandlers(session, app, { callerAgent });
    expect(parseHandlerResult(await h.startPlan({ plan_id: 99 }))).toEqual({
      ok: false,
      error: 'Plan not found',
    });
    expect(parseHandlerResult(await h.startPlan({ plan_id: 5 }))).toEqual({
      ok: false,
      error: 'Plan is completed',
    });
  });
});

describe('createPlanHandlers.readPlan', () => {
  it('defaults to the calling agent current plan', async () => {
    const callerAgent = { id: 20, current_plan_id: 4 };
    const { app } = makeApp({
      plans: [
        { id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# Other' },
        { id: 4, session_id: 1, ref: 2, status: 'open', markdown: '# Current' },
      ],
    });
    const h = createPlanHandlers(session, app, { callerAgent });
    const out = parseHandlerResult(await h.readPlan());
    expect(out).toEqual({
      ok: true,
      id: 4,
      ref: 2,
      status: 'open',
      markdown: '# Current',
    });
  });

  it('accepts plan_id or ref and fails clearly when none is current', async () => {
    const { app } = makeApp({
      plans: [{ id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# Plan' }],
    });
    const h = createPlanHandlers(session, app);
    expect(parseHandlerResult(await h.readPlan())).toEqual({
      ok: false,
      error:
        'No current plan for this agent; pass plan_id or ref from ListPlans, or call StartPlan after CreatePlan',
    });
    expect(parseHandlerResult(await h.readPlan({ ref: 1 }))).toMatchObject({
      ok: true,
      markdown: '# Plan',
    });
  });
});

describe('createPlanHandlers.editPlan', () => {
  it('defaults to the current plan', async () => {
    const callerAgent = { id: 20, current_plan_id: 3 };
    const { app, planStore } = makeApp({
      plans: [{ id: 3, session_id: 1, ref: 1, status: 'open', markdown: 'Step one.' }],
    });
    const h = createPlanHandlers(session, app, { callerAgent });
    const out = parseHandlerResult(
      await h.editPlan({ patches: [{ old_string: 'one', new_string: 'two' }] })
    );
    expect(out).toMatchObject({ ok: true, markdown: 'Step two.' });
    expect(planStore[0].markdown).toBe('Step two.');
  });

  it('rejects when no current plan and no plan_id/ref', async () => {
    const { app } = makeApp();
    const h = createPlanHandlers(session, app);
    const out = parseHandlerResult(
      await h.editPlan({ patches: [{ old_string: 'x', new_string: 'y' }] })
    );
    expect(out).toEqual({
      ok: false,
      error:
        'No current plan for this agent; pass plan_id or ref from ListPlans, or call StartPlan after CreatePlan',
    });
  });
});

describe('createPlanHandlers.listPlans', () => {
  it('returns session plans and current_plan_id', async () => {
    const callerAgent = { id: 20, current_plan_id: 3 };
    const { app } = makeApp({
      plans: [
        { id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# A' },
        { id: 4, session_id: 1, ref: 2, status: 'completed', markdown: '# B' },
        { id: 5, session_id: 2, ref: 1, status: 'open', markdown: '# Other session' },
      ],
    });
    const h = createPlanHandlers(session, app, { callerAgent });
    const out = parseHandlerResult(await h.listPlans());
    expect(out.ok).toBe(true);
    expect(out.current_plan_id).toBe(3);
    expect(out.plans).toEqual([
      { id: 3, ref: 1, status: 'open', markdown: '# A' },
      { id: 4, ref: 2, status: 'completed', markdown: '# B' },
    ]);
  });

  it('filters by status', async () => {
    const { app } = makeApp({
      plans: [
        { id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# A' },
        { id: 4, session_id: 1, ref: 2, status: 'completed', markdown: '# B' },
      ],
    });
    const h = createPlanHandlers(session, app);
    const out = parseHandlerResult(await h.listPlans({ status: 'open' }));
    expect(out.ok).toBe(true);
    expect(out.current_plan_id).toBeNull();
    expect(out.plans).toEqual([{ id: 3, ref: 1, status: 'open', markdown: '# A' }]);
  });
});

describe('createPlanHandlers.completePlan', () => {
  it('marks the plan completed and clears current_plan_id on every attached agent', async () => {
    const callerAgent = { id: 20, current_plan_id: 3 };
    const other = { id: 21, current_plan_id: 3 };
    const unrelated = { id: 22, current_plan_id: 9 };
    const { app, planStore, agentStore } = makeApp({
      plans: [{ id: 3, session_id: 1, ref: 1, status: 'open', markdown: '# Plan' }],
      agents: [callerAgent, other, unrelated],
    });
    const h = createPlanHandlers(session, app, { callerAgent });
    const out = parseHandlerResult(await h.completePlan());
    expect(out).toMatchObject({ ok: true, id: 3, status: 'completed' });
    expect(planStore[0].status).toBe('completed');
    expect(agentStore.find((a) => a.id === 20).current_plan_id).toBeNull();
    expect(agentStore.find((a) => a.id === 21).current_plan_id).toBeNull();
    expect(agentStore.find((a) => a.id === 22).current_plan_id).toBe(9);
    expect(callerAgent.current_plan_id).toBeNull();
  });
});
