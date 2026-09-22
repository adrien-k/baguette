import { describe, it, expect } from 'vitest';
import { buildSeries, recentDays, sumBy, SERIES_COLORS, OTHER_KEY } from '../usageSeries.js';

const row = (day, repo, sdk, cost) => ({
  day,
  repo_full_name: repo,
  agent_sdk: sdk,
  cost_usd: cost,
});

const rows = [
  row('2026-09-20', 'acme/alpha', 'claude', 3),
  row('2026-09-20', 'acme/alpha', 'cursor', 1),
  row('2026-09-20', 'acme/beta', 'claude', 8),
  row('2026-09-21', 'acme/alpha', 'claude', 2),
];

describe('sumBy', () => {
  it('totals rows per key', () => {
    expect([...sumBy(rows, (r) => r.agent_sdk)]).toEqual([
      ['claude', 13],
      ['cursor', 1],
    ]);
  });
});

describe('buildSeries by repo', () => {
  it('builds one series per repo, largest first', () => {
    const { series } = buildSeries(rows, 'repo');
    expect(series.map((s) => [s.key, s.total])).toEqual([
      ['acme/beta', 8],
      ['acme/alpha', 6], // 3 + 1 + 2
    ]);
  });

  it('keeps the full repo name as the title behind the shortened label', () => {
    const { series } = buildSeries(rows, 'repo');
    expect(series.map((s) => [s.label, s.title])).toEqual([
      ['beta', 'acme/beta'],
      ['alpha', 'acme/alpha'],
    ]);
  });

  it('splits each day across repos', () => {
    const { byDay } = buildSeries(rows, 'repo');
    expect([...byDay.get('2026-09-20')]).toEqual([
      ['acme/alpha', 4],
      ['acme/beta', 8],
    ]);
    expect([...byDay.get('2026-09-21')]).toEqual([['acme/alpha', 2]]);
  });

  it('gives a repo the same colour regardless of how it ranks', () => {
    const colorOf = (data, repo) =>
      buildSeries(data, 'repo').series.find((s) => s.key === repo).color;

    // Make alpha the top spender; beta must keep the colour it had before.
    const flipped = [...rows, row('2026-09-22', 'acme/alpha', 'claude', 100)];
    expect(colorOf(flipped, 'acme/beta')).toBe(colorOf(rows, 'acme/beta'));
    expect(colorOf(flipped, 'acme/alpha')).toBe(colorOf(rows, 'acme/alpha'));
  });

  it('folds repos past the palette into a single "Other" series, listed last', () => {
    const many = Array.from({ length: SERIES_COLORS.length + 3 }, (_, i) =>
      // Earlier repos spend more, so the last three are the ones that fold.
      row('2026-09-20', `acme/repo-${String(i).padStart(2, '0')}`, 'claude', 100 - i)
    );

    const { series, byDay } = buildSeries(many, 'repo');
    expect(series).toHaveLength(SERIES_COLORS.length + 1);
    expect(series.at(-1).key).toBe(OTHER_KEY);
    expect(series.at(-1).label).toBe('Other (3 repos)');
    expect(series.at(-1).total).toBe(92 + 91 + 90);
    expect(byDay.get('2026-09-20').get(OTHER_KEY)).toBe(92 + 91 + 90);

    const colors = series.slice(0, -1).map((s) => s.color);
    expect(new Set(colors).size).toBe(SERIES_COLORS.length);
  });

  it('labels a single folded repo in the singular', () => {
    const many = Array.from({ length: SERIES_COLORS.length + 1 }, (_, i) =>
      row('2026-09-20', `acme/repo-${String(i).padStart(2, '0')}`, 'claude', 100 - i)
    );
    expect(buildSeries(many, 'repo').series.at(-1).label).toBe('Other (1 repo)');
  });
});

describe('buildSeries by sdk', () => {
  it('builds one series per agent with friendly labels', () => {
    const { series, byDay } = buildSeries(rows, 'sdk');
    expect(series.map((s) => [s.key, s.label, s.total])).toEqual([
      ['claude', 'Claude', 13],
      ['cursor', 'Cursor', 1],
    ]);
    expect([...byDay.get('2026-09-20')]).toEqual([
      ['claude', 11],
      ['cursor', 1],
    ]);
  });

  it('falls back to the raw name and neutral colour for an unknown agent', () => {
    const { series } = buildSeries([row('2026-09-20', 'acme/alpha', 'codex', 5)], 'sdk');
    expect(series[0].label).toBe('codex');
    expect(series[0].color).toBe('bg-zinc-600');
  });
});

describe('recentDays', () => {
  it('returns 30 unique UTC days, oldest first, ending today', () => {
    const days = recentDays();
    expect(days).toHaveLength(30);
    expect(new Set(days).size).toBe(30);
    expect([...days].sort()).toEqual(days);
    expect(days.at(-1)).toBe(new Date().toISOString().slice(0, 10));
  });
});
