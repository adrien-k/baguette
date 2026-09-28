import { describe, it, expect } from 'vitest';
import { parseChangedFilesResponse } from '../changedFilesResponse.js';

describe('parseChangedFilesResponse', () => {
  it('maps file rows when there is no error', () => {
    expect(
      parseChangedFilesResponse({
        files: [{ old_path: 'a.js', new_path: 'a.js', added_count: 1, removed_count: 0 }],
      })
    ).toEqual([{ oldPath: 'a.js', newPath: 'a.js', addedCount: 1, removedCount: 0 }]);
  });

  it('throws when the API returned an error field', () => {
    expect(() => parseChangedFilesResponse({ files: [], error: 'git failed' })).toThrow(
      'git failed'
    );
  });
});
