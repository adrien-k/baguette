import { describe, it, expect } from 'vitest';
import { insertSessionMessageById, mergeSessionMessagesFromFetch } from '../sessionMessageOrder.js';

describe('insertSessionMessageById', () => {
  it('appends when id is newest', () => {
    const prev = [{ id: 1 }, { id: 2 }];
    expect(insertSessionMessageById(prev, { id: 3 })).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('inserts in the middle when ids arrive out of order', () => {
    const prev = [{ id: 1 }, { id: 3 }];
    expect(insertSessionMessageById(prev, { id: 2 })).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('replaces an existing row by id', () => {
    const prev = [{ id: 1 }, { id: 2, v: 0 }];
    expect(insertSessionMessageById(prev, { id: 2, v: 1 })).toEqual([{ id: 1 }, { id: 2, v: 1 }]);
  });
});

describe('mergeSessionMessagesFromFetch', () => {
  it('merges newer rows and sorts when the tail was appended out of order', () => {
    const prev = [{ id: 10 }, { id: 12 }, { id: 11 }];
    const fetched = [{ id: 11, patched: true }, { id: 12 }, { id: 13 }];
    expect(mergeSessionMessagesFromFetch(prev, fetched)).toEqual([
      { id: 10 },
      { id: 11, patched: true },
      { id: 12 },
      { id: 13 },
    ]);
  });

  it('inserts missing rows inside the loaded id window', () => {
    const prev = [{ id: 5 }, { id: 7 }];
    const fetched = [{ id: 5 }, { id: 6 }, { id: 7 }];
    expect(mergeSessionMessagesFromFetch(prev, fetched)).toEqual([{ id: 5 }, { id: 6 }, { id: 7 }]);
  });

  it('returns the same array reference when nothing changes', () => {
    const prev = [{ id: 1 }, { id: 2 }];
    expect(mergeSessionMessagesFromFetch(prev, [])).toBe(prev);
  });
});
