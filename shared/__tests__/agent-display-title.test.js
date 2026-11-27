import { describe, it, expect } from 'vitest';
import {
  GITHUB_REF_WORD_JOINER,
  escapeGithubHashRefs,
  unescapeGithubHashRefs,
} from '../agent-display-title.js';

describe('escapeGithubHashRefs', () => {
  it('inserts a word joiner after hash before digits', () => {
    expect(escapeGithubHashRefs('Fixes #42 and #7')).toBe(
      `Fixes #${GITHUB_REF_WORD_JOINER}42 and #${GITHUB_REF_WORD_JOINER}7`
    );
  });

  it('does not double-escape or touch markdown headings', () => {
    const once = `Ref #${GITHUB_REF_WORD_JOINER}1`;
    expect(escapeGithubHashRefs(once)).toBe(once);
    expect(escapeGithubHashRefs('## Summary')).toBe('## Summary');
  });

  it('passes through empty values', () => {
    expect(escapeGithubHashRefs('')).toBe('');
    expect(escapeGithubHashRefs(null)).toBe('');
  });
});

describe('unescapeGithubHashRefs', () => {
  it('removes word joiners GitHub footers use', () => {
    expect(unescapeGithubHashRefs(`#${GITHUB_REF_WORD_JOINER}3 Builder`)).toBe('#3 Builder');
  });

  it('round-trips with escapeGithubHashRefs', () => {
    const raw = '- Closes #99\n- See also #100';
    expect(unescapeGithubHashRefs(escapeGithubHashRefs(raw))).toBe(raw);
  });
});
