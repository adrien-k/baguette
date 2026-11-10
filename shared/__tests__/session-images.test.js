import { describe, it, expect } from 'vitest';
import {
  sessionImagePlaceholder,
  findSessionImagePlaceholders,
  hasSessionImagePlaceholders,
  interpolateSessionImagePlaceholders,
  stripSessionImagePlaceholders,
  localSessionImageUrl,
  sessionImageFileName,
  SESSION_IMAGE_MEDIA_TYPES,
} from '../session-images.js';

describe('shared/session-images', () => {
  it('builds placeholders from image slugs', () => {
    expect(sessionImagePlaceholder('abc-123')).toBe('{{image:abc-123}}');
  });

  it('finds placeholders in first-occurrence order and dedupes them', () => {
    const text = 'start {{image:b}} middle {{image:a}} end {{image:b}}';
    expect(findSessionImagePlaceholders(text)).toEqual(['b', 'a']);
    expect(hasSessionImagePlaceholders('no images')).toBe(false);
    expect(hasSessionImagePlaceholders('an {{image:x}} here')).toBe(true);
  });

  it('interpolates resolvable placeholders and keeps unresolvable ones', () => {
    const text = 'A: {{image:a}}\nB: {{image:b}}\nC: {{image:c}}';
    const out = interpolateSessionImagePlaceholders(text, (id) => {
      if (id === 'a')
        return { url: 'https://github.com/user-attachments/assets/a1', alt_text: 'before' };
      if (id === 'b') return { url: '/api/session-images/22/file', alt_text: '' };
      return null;
    });
    expect(out).toBe(
      'A: ![before](https://github.com/user-attachments/assets/a1)\nB: ![image](/api/session-images/22/file)\nC: {{image:c}}'
    );
  });

  it('interpolates empty text safely', () => {
    expect(interpolateSessionImagePlaceholders('', () => null)).toBe('');
    expect(stripSessionImagePlaceholders(undefined)).toBe('');
  });

  it('strips placeholders for plain-text contexts', () => {
    expect(stripSessionImagePlaceholders('Summary\n\n{{image:x}}\n\nFooter')).toBe(
      'Summary\n\n\n\nFooter'
    );
  });

  it('builds the authenticated session image URL from a row', () => {
    const row = { id: 42, image_slug: 'abc', file_ext: '.png' };
    expect(localSessionImageUrl(row)).toBe('/api/session-images/42/file');
    expect(localSessionImageUrl(row, 'https://bag.example.com/')).toBe(
      'https://bag.example.com/api/session-images/42/file'
    );
    expect(sessionImageFileName('abc', '.png')).toBe('abc.png');
  });

  it('maps all attachable media types to extensions', () => {
    expect(Object.keys(SESSION_IMAGE_MEDIA_TYPES).sort()).toEqual([
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(Object.values(SESSION_IMAGE_MEDIA_TYPES)).toEqual(['.png', '.jpg', '.gif', '.webp']);
  });
});
