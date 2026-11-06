import { describe, expect, it } from 'vitest';
import { userAvatarBackground, userAvatarInitial } from '../userAvatar.js';

describe('userAvatarInitial', () => {
  it('uses the first capital letter', () => {
    expect(userAvatarInitial('alice')).toBe('A');
    expect(userAvatarInitial('  bob')).toBe('B');
  });

  it('falls back when the name is empty', () => {
    expect(userAvatarInitial('')).toBe('?');
    expect(userAvatarInitial(null)).toBe('?');
  });
});

describe('userAvatarBackground', () => {
  it('is stable for a given name and differs across names', () => {
    expect(userAvatarBackground('dev')).toBe(userAvatarBackground('dev'));
    expect(userAvatarBackground('dev')).not.toBe(userAvatarBackground('e2e-other'));
    expect(userAvatarBackground('dev')).toMatch(/^hsl\(\d+ 52% 40%\)$/);
  });
});
