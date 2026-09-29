import { describe, it, expect } from 'vitest';
import {
  BAGUETTE_DESCRIPTION_MARKER,
  BAGUETTE_FOOTER_MARKER,
  splitPrBody,
  buildSessionFooter,
  buildPrBody,
} from '../github.js';

describe('splitPrBody', () => {
  it('strips baguette footer from baguette content', () => {
    const body = [
      'Notes',
      '',
      BAGUETTE_DESCRIPTION_MARKER,
      '---',
      '',
      'Summary',
      '',
      '---',
      '',
      BAGUETTE_FOOTER_MARKER,
      '',
      '_Preview: https://example.com/_',
      '_cursor / `gpt-5` · In: 1k · Out: 200 · Cache read: 0 · Cache write: 0 · Cost: $0_',
    ].join('\n');
    const { userPrefix, baguetteContent } = splitPrBody(body);
    expect(userPrefix).toBe('Notes');
    expect(baguetteContent).toBe('Summary');
  });

  it('strips legacy italic footer from baguette content', () => {
    const body = `${BAGUETTE_DESCRIPTION_MARKER}\n---\n\nSummary\n\n---\n_harness: claude · Model: \`x\`_`;
    expect(splitPrBody(body).baguetteContent).toBe('Summary');
  });
});

describe('buildSessionFooter', () => {
  it('uses one line per preview and usage entry', () => {
    const footer = buildSessionFooter(
      {},
      {
        previewUrl: 'https://session.example.com/',
        usageLines: [
          'cursor / `gpt-5` · In: 10k · Out: 2k · Cache read: 1k · Cache write: 0 · Cost: $0.12',
        ],
      }
    );
    expect(footer).toBe(
      [
        '',
        '',
        '---',
        '',
        BAGUETTE_FOOTER_MARKER,
        '',
        '_Preview: https://session.example.com/_',
        '_cursor / `gpt-5` · In: 10k · Out: 2k · Cache read: 1k · Cache write: 0 · Cost: $0.12_',
      ].join('\n')
    );
  });

  it('includes preview URL only when no usage lines', () => {
    const footer = buildSessionFooter({}, { previewUrl: 'https://session-abc.example.com/' });
    expect(footer).toContain('_Preview: https://session-abc.example.com/_');
    expect(footer).not.toContain('Harness:');
  });

  it('replaces prior footer on each build (no accumulation)', () => {
    const first = buildSessionFooter(
      {},
      { usageLines: ['claude / `a` · In: 0 · Out: 0 · Cache read: 0 · Cache write: 0 · Cost: $0'] }
    );
    const second = buildSessionFooter(
      {},
      { usageLines: ['cursor / `b` · In: 0 · Out: 0 · Cache read: 0 · Cache write: 0 · Cost: $0'] }
    );
    expect(first).toContain('claude / `a`');
    expect(second).toContain('cursor / `b`');
    expect(second).not.toContain('claude / `a`');
  });
});

describe('buildPrBody', () => {
  it('embeds footer after baguette content', () => {
    const body = buildPrBody(
      'User notes',
      'Agent summary',
      buildSessionFooter(
        {},
        {
          usageLines: ['cursor / `x` · In: 0 · Out: 0 · Cache read: 0 · Cache write: 0 · Cost: $0'],
        }
      )
    );
    expect(body).toBe(
      [
        'User notes',
        '',
        BAGUETTE_DESCRIPTION_MARKER,
        '---',
        '',
        'Agent summary',
        '',
        '---',
        '',
        BAGUETTE_FOOTER_MARKER,
        '',
        '_cursor / `x` · In: 0 · Out: 0 · Cache read: 0 · Cache write: 0 · Cost: $0_',
      ].join('\n')
    );
  });
});
