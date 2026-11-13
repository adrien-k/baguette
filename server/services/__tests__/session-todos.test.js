import { describe, it, expect } from 'vitest';
import { serializeTodo } from '../session-todos.js';

describe('serializeTodo', () => {
  it('includes title when present', () => {
    const row = {
      id: 1,
      ref: 2,
      session_id: 3,
      title: 'Add migration',
      content: 'Write the migration file.',
      status: 'pending',
      sort_order: 0,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    expect(serializeTodo(row)).toMatchObject({
      title: 'Add migration',
      content: 'Write the migration file.',
      plan_id: null,
    });
  });

  it('returns null title for legacy rows', () => {
    const row = {
      id: 1,
      ref: 1,
      session_id: 1,
      content: 'Legacy body',
      status: 'pending',
      sort_order: 0,
      created_at: null,
      updated_at: null,
    };
    expect(serializeTodo(row).title).toBeNull();
    expect(serializeTodo(row).plan_id).toBeNull();
  });

  it('includes plan_id when present', () => {
    const row = {
      id: 1,
      ref: 1,
      session_id: 1,
      plan_id: 9,
      title: 'Attached',
      content: 'Body',
      status: 'pending',
      sort_order: 0,
      created_at: null,
      updated_at: null,
    };
    expect(serializeTodo(row).plan_id).toBe(9);
  });
});
