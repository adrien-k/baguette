import { describe, it, expect } from 'vitest';
import { localizeSessionImageUrls } from '../sessionDescription.js';

describe('localizeSessionImageUrls', () => {
  it('rewrites absolute /api/images URLs to same-origin paths', () => {
    const md = 'Preview:\n\n![before](https://api.example.com/api/images/abc-123.png)';
    expect(localizeSessionImageUrls(md)).toBe('Preview:\n\n![before](/api/images/abc-123.png)');
  });

  it('rewrites localhost hosts too', () => {
    expect(localizeSessionImageUrls('![shot](http://localhost:3000/api/images/x.webp)')).toBe(
      '![shot](/api/images/x.webp)'
    );
  });

  it('leaves non-image URLs untouched', () => {
    expect(localizeSessionImageUrls('![shot](https://example.com/img.png)')).toBe(
      '![shot](https://example.com/img.png)'
    );
  });

  it('passes through markdown without images and empty input', () => {
    expect(localizeSessionImageUrls('plain text')).toBe('plain text');
    expect(localizeSessionImageUrls(null)).toBe('');
    expect(localizeSessionImageUrls('')).toBe('');
  });
});
