import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isComposerEnterSubmitKey } from '../composerEnterSubmit.js';

describe('isComposerEnterSubmitKey', () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: { userAgent: 'Mozilla/5.0' },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  it('accepts Enter without shift on desktop', () => {
    expect(isComposerEnterSubmitKey({ key: 'Enter', shiftKey: false })).toBe(true);
  });

  it('rejects Shift+Enter', () => {
    expect(isComposerEnterSubmitKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  it('rejects Enter on mobile user agents', () => {
    Object.defineProperty(global, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      configurable: true,
    });
    expect(isComposerEnterSubmitKey({ key: 'Enter', shiftKey: false })).toBe(false);
  });
});
