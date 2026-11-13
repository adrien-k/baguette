import { describe, it, expect } from 'vitest';
import { countryCodeToFlagEmoji } from '../countryFlag.js';

describe('countryCodeToFlagEmoji', () => {
  it('maps ISO codes to regional indicators', () => {
    expect(countryCodeToFlagEmoji('FR')).toBe('🇫🇷');
    expect(countryCodeToFlagEmoji('us')).toBe('🇺🇸');
  });

  it('returns empty for invalid codes', () => {
    expect(countryCodeToFlagEmoji('')).toBe('');
    expect(countryCodeToFlagEmoji('XXX')).toBe('');
  });
});
