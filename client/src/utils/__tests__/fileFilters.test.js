import { describe, expect, it } from 'vitest';
import { compileFileFilters, fileMatchesFilters, filterDiffFiles } from '../fileFilters.js';

describe('compileFileFilters', compilesSuite);

function compilesSuite() {
  it('returns an inactive filter for empty patterns', () => {
    const filters = compileFileFilters('', '');
    expect(filters.include).toBeNull();
    expect(filters.exclude).toBeNull();
    expect(filters.includeError).toBeNull();
    expect(filters.excludeError).toBeNull();
    expect(filters.active).toBe(false);
  });

  it('compiles valid patterns case-sensitively', () => {
    const filters = compileFileFilters('\\.md$', 'docs/');
    expect(filters.include).toBeInstanceOf(RegExp);
    expect(filters.exclude).toBeInstanceOf(RegExp);
    expect(filters.active).toBe(true);
    expect(filters.include.test('readme.MD')).toBe(false);
    expect(filters.include.test('docs/readme.md')).toBe(true);
  });

  it('reports errors per pattern without disabling the other', () => {
    const filters = compileFileFilters('a(', 'docs/');
    expect(filters.include).toBeNull();
    expect(filters.includeError).toBeTruthy();
    expect(filters.exclude).toBeInstanceOf(RegExp);
    expect(filters.active).toBe(true);
  });

  it('treats whitespace-only patterns as empty', () => {
    expect(compileFileFilters('   ', '').active).toBe(false);
  });
}

describe('fileMatchesFilters', matchesSuite);

function matchesSuite() {
  it('passes everything without filters', () => {
    expect(fileMatchesFilters('src/a.js', null)).toBe(true);
    expect(fileMatchesFilters('src/a.js', compileFileFilters('', ''))).toBe(true);
  });

  it('applies include as a search-anywhere match', () => {
    const filters = compileFileFilters('client/src', '');
    expect(fileMatchesFilters('client/src/app.jsx', filters)).toBe(true);
    expect(fileMatchesFilters('server/app.js', filters)).toBe(false);
  });

  it('applies exclude as rejection on match', () => {
    const filters = compileFileFilters('', '\\.test\\.js$');
    expect(fileMatchesFilters('src/app.js', filters)).toBe(true);
    expect(fileMatchesFilters('src/app.test.js', filters)).toBe(false);
  });

  it('requires both include and exclude to pass', () => {
    const filters = compileFileFilters('\\.js$', 'client/');
    expect(fileMatchesFilters('server/app.js', filters)).toBe(true);
    expect(fileMatchesFilters('client/app.jsx', filters)).toBe(false);
    expect(fileMatchesFilters('client/app.js', filters)).toBe(false);
  });

  it('rejects everything when the include regex is invalid', () => {
    const filters = compileFileFilters('a(', '');
    expect(filters.active).toBe(false);
    expect(fileMatchesFilters('src/a.js', filters)).toBe(true);
  });
}

describe('filterDiffFiles', filterSuite);

function filterSuite() {
  const files = [
    { oldPath: 'client/src/app.jsx', newPath: 'client/src/app.jsx' },
    { oldPath: 'client/src/app.test.jsx', newPath: 'client/src/app.test.jsx' },
    { oldPath: 'server/app.js', newPath: 'server/app.js' },
  ];

  it('returns the input array untouched when filters are inactive', () => {
    const filters = compileFileFilters('', '');
    expect(filterDiffFiles(files, filters)).toBe(files);
  });

  it('filters by display path', () => {
    const filters = compileFileFilters('\\.jsx$', '\\.test\\.');
    expect(filterDiffFiles(files, filters).map((f) => f.newPath)).toEqual(['client/src/app.jsx']);
  });

  it('uses the new path for renamed files', () => {
    const filters = compileFileFilters('renamed\\.js$', '');
    expect(
      filterDiffFiles([{ oldPath: 'old-name.js', newPath: 'renamed.js' }], filters)
    ).toHaveLength(1);
  });
}
