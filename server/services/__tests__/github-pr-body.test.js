import { describe, it, expect } from 'vitest';
import {
  BAGUETTE_DESCRIPTION_MARKER,
  BAGUETTE_FOOTER_MARKER,
  splitPrBody,
  buildSessionFooter,
  buildPrBody,
  descriptionHasImage,
  baguetteDescriptionLink,
  withDescriptionLink,
} from '../github.js';
import { PUBLIC_HOST } from '../../config.js';

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

  it('puts the Open Session link on the preview line', () => {
    const footer = buildSessionFooter(
      { id: 1 },
      { previewUrl: 'https://session.example.com/', usageLines: ['claude / `a` · Cost: $0'] }
    );
    const lines = footer.split('\n');
    const preview = lines.indexOf(
      `_Preview: https://session.example.com/ | [Open Session](${PUBLIC_HOST}/sessions/1)_`
    );
    expect(preview).toBeGreaterThan(-1);
    expect(lines[preview + 1]).toBe('_claude / `a` · Cost: $0_');
  });

  it('shows only the Open Session link when there is no preview', () => {
    const footer = buildSessionFooter({ id: 2 });
    expect(footer).toContain(`_[Open Session](${PUBLIC_HOST}/sessions/2)_`);
    expect(footer).not.toContain('Preview:');
  });

  it('omits the Open Session link when the session has no id', () => {
    const footer = buildSessionFooter({}, { previewUrl: 'https://session.example.com/' });
    expect(footer).not.toContain('Open Session');
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

describe('withDescriptionLink', () => {
  it('detects markdown images, img tags, and image placeholders', () => {
    expect(descriptionHasImage('![shot](https://x/api/images/a.png)')).toBe(true);
    expect(descriptionHasImage('see <img src="https://x/a.png"> here')).toBe(true);
    expect(descriptionHasImage('attached at push: {{image:abc-123}}')).toBe(true);
    expect(descriptionHasImage('text only')).toBe(false);
    expect(descriptionHasImage('')).toBe(false);
    expect(descriptionHasImage(null)).toBe(false);
  });

  it('builds a link to the session description page', () => {
    expect(baguetteDescriptionLink(42)).toContain('/session/42/description');
  });

  it('prepends the link only when the description embeds an image', () => {
    const content = '![shot](https://baguette.example.com/api/images/a.png)';
    const linked = withDescriptionLink(7, content);
    expect(linked.startsWith(`Images not showing? [Open the full description in Baguette]`)).toBe(
      true
    );
    expect(linked).toContain('/session/7/description');
    expect(linked.endsWith(content)).toBe(true);
    expect(withDescriptionLink(7, '{{image:abc}}')).toContain('Images not showing?');
    expect(withDescriptionLink(7, 'text only')).toBe('text only');
    expect(withDescriptionLink(7, '')).toBe('');
  });

  it('keeps the link inside the baguette section so it is not preserved as user prefix', () => {
    const body = buildPrBody('User notes', withDescriptionLink(7, '![a](https://x/i.png)'));
    const { userPrefix, baguetteContent } = splitPrBody(body);
    expect(userPrefix).toBe('User notes');
    expect(baguetteContent).toContain('Images not showing?');
  });

  it('keeps placeholder-based descriptions with the link inside the baguette section', () => {
    const body = buildPrBody('User notes', withDescriptionLink(7, 'parity:\n\n{{image:abc}}'));
    const { userPrefix, baguetteContent } = splitPrBody(body);
    expect(userPrefix).toBe('User notes');
    expect(baguetteContent).toContain('Images not showing?');
    expect(baguetteContent).toContain('{{image:abc}}');
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
