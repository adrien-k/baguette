import { describe, it, expect } from 'vitest';
import { parseGitNumstat } from '../github.js';

describe('parseGitNumstat', () => {
  it('returns empty array for blank output', () => {
    expect(parseGitNumstat('')).toEqual([]);
    expect(parseGitNumstat('\0\n')).toEqual([]);
  });

  it('parses a regular file record', () => {
    const stdout = `12\t3\tclient/src/App.jsx\0`;
    expect(parseGitNumstat(stdout)).toEqual([
      {
        old_path: 'client/src/App.jsx',
        new_path: 'client/src/App.jsx',
        added_count: 12,
        removed_count: 3,
      },
    ]);
  });

  it('treats binary dashes as zero', () => {
    const stdout = `-\t-\tassets/logo.png\0`;
    expect(parseGitNumstat(stdout)).toEqual([
      {
        old_path: 'assets/logo.png',
        new_path: 'assets/logo.png',
        added_count: 0,
        removed_count: 0,
      },
    ]);
  });

  it('parses a rename record', () => {
    const stdout = `1\t1\0old/name.js\0new/name.js\0`;
    expect(parseGitNumstat(stdout)).toEqual([
      {
        old_path: 'old/name.js',
        new_path: 'new/name.js',
        added_count: 1,
        removed_count: 1,
      },
    ]);
  });

  it('parses mixed regular and rename records', () => {
    const stdout = '4\t0\ta.js\0' + '1\t1\0b.js\0c.js\0';
    expect(parseGitNumstat(stdout)).toEqual([
      { old_path: 'a.js', new_path: 'a.js', added_count: 4, removed_count: 0 },
      { old_path: 'b.js', new_path: 'c.js', added_count: 1, removed_count: 1 },
    ]);
  });
});
