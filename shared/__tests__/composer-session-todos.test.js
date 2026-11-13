import { describe, it, expect } from 'vitest';
import {
  COMPOSER_OPEN_TODO_STATUSES,
  filterComposerSessionTodos,
  parsePositiveInt,
  resolveOpenCurrentPlan,
} from '../composer-session-todos.js';

describe('parsePositiveInt', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveInt(3)).toBe(3);
    expect(parsePositiveInt('4')).toBe(4);
  });

  it('rejects non-positive values', () => {
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt(-1)).toBeNull();
    expect(parsePositiveInt('x')).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
  });
});

describe('resolveOpenCurrentPlan', () => {
  const plans = [
    { id: 1, status: 'open' },
    { id: 2, status: 'completed' },
  ];

  it('returns the plan when attached and open', () => {
    expect(resolveOpenCurrentPlan(plans, 1)).toEqual({ id: 1, status: 'open' });
  });

  it('returns null when plan is completed or missing', () => {
    expect(resolveOpenCurrentPlan(plans, 2)).toBeNull();
    expect(resolveOpenCurrentPlan(plans, 99)).toBeNull();
    expect(resolveOpenCurrentPlan(plans, null)).toBeNull();
  });
});

describe('filterComposerSessionTodos', () => {
  const plans = [
    { id: 10, status: 'open' },
    { id: 11, status: 'completed' },
  ];

  const todos = [
    { id: 1, ref: 1, plan_id: null, status: 'pending' },
    { id: 2, ref: 2, plan_id: null, status: 'completed' },
    { id: 3, ref: 3, plan_id: 10, status: 'pending' },
    { id: 4, ref: 4, plan_id: 10, status: 'completed' },
    { id: 5, ref: 5, plan_id: 11, status: 'pending' },
  ];

  it('shows only open-plan todos including completed when agent is on an open plan', () => {
    const filtered = filterComposerSessionTodos(todos, { currentPlanId: 10, plans });
    expect(filtered.map((t) => t.id)).toEqual([3, 4]);
  });

  it('keeps drawer list non-empty when every plan todo is completed but plan stays open', () => {
    const onlyCompleted = [
      { id: 4, ref: 4, plan_id: 10, status: 'completed' },
      { id: 1, ref: 1, plan_id: null, status: 'pending' },
    ];
    const filtered = filterComposerSessionTodos(onlyCompleted, { currentPlanId: 10, plans });
    expect(filtered.map((t) => t.id)).toEqual([4]);
  });

  it('shows only open unattached todos when there is no open current plan', () => {
    expect(
      filterComposerSessionTodos(todos, { currentPlanId: null, plans }).map((t) => t.id)
    ).toEqual([1]);
    expect(
      filterComposerSessionTodos(todos, { currentPlanId: 11, plans }).map((t) => t.id)
    ).toEqual([1]);
  });

  it('drops completed unattached todos immediately', () => {
    const rows = [{ id: 2, plan_id: null, status: 'completed' }];
    expect(filterComposerSessionTodos(rows, { currentPlanId: null, plans })).toEqual([]);
  });

  it('hides todos attached to other or completed plans without an open current plan', () => {
    expect(
      filterComposerSessionTodos(todos, { currentPlanId: null, plans }).some(
        (t) => t.plan_id === 11
      )
    ).toBe(false);
  });

  it('exports open status set for composer unattached mode', () => {
    expect(COMPOSER_OPEN_TODO_STATUSES.has('pending')).toBe(true);
    expect(COMPOSER_OPEN_TODO_STATUSES.has('completed')).toBe(false);
  });
});
