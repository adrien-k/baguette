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
      BAGUETTE_FOOTER_MARKER,
      '',
      'Harness: cursor · Model: `claude-4`',
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
  it('uses Harness label and baguette-footer marker', () => {
    const footer = buildSessionFooter({ agent_sdk: 'cursor', model: 'gpt-5' });
    expect(footer).toBe(`\n\n${BAGUETTE_FOOTER_MARKER}\n\nHarness: cursor · Model: \`gpt-5\``);
  });

  it('replaces prior footer on each build (no accumulation)', () => {
    const first = buildSessionFooter({ agent_sdk: 'claude', model: 'a' });
    const second = buildSessionFooter({ agent_sdk: 'cursor', model: 'b' });
    expect(first).toContain('Harness: claude');
    expect(second).toContain('Harness: cursor');
    expect(second).not.toContain('Harness: claude');
  });
});

describe('buildPrBody', () => {
  it('embeds footer after baguette content', () => {
    const body = buildPrBody(
      'User notes',
      'Agent summary',
      buildSessionFooter({ agent_sdk: 'cursor' })
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
        BAGUETTE_FOOTER_MARKER,
        '',
        'Harness: cursor',
      ].join('\n')
    );
  });
});
