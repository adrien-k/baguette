import { describe, it, expect } from 'vitest';
import { rowPatchIsNoop } from '../backfill-db.js';

describe('backfill-db', () => {
  it('rowPatchIsNoop treats null turn_id as equal', () => {
    expect(rowPatchIsNoop({ turn_id: null }, { turn_id: null })).toBe(true);
    expect(rowPatchIsNoop({ turn_id: 2 }, { turn_id: 2 })).toBe(true);
    expect(rowPatchIsNoop({ turn_id: 1 }, { turn_id: 2 })).toBe(false);
  });
});
