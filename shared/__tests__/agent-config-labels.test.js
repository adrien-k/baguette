import { describe, it, expect } from 'vitest';
import { sdkDisplayName, accountAgentConfigLabel } from '../agent-config-labels.js';

describe('sdkDisplayName', () => {
  it('prefers an explicit plugin/meta label', () => {
    expect(sdkDisplayName('claude', 'Claude')).toBe('Claude');
    expect(sdkDisplayName('future', 'Future SDK')).toBe('Future SDK');
  });

  it('falls back to capitalizing the sdk key', () => {
    expect(sdkDisplayName('claude')).toBe('Claude');
    expect(sdkDisplayName('cursor')).toBe('Cursor');
    expect(sdkDisplayName('pi')).toBe('Pi');
    expect(sdkDisplayName('mock')).toBe('Mock');
  });
});

describe('accountAgentConfigLabel', () => {
  it('truncates the capitalized sdk name', () => {
    expect(accountAgentConfigLabel('claude')).toBe('Claude');
    expect(accountAgentConfigLabel('cursor')).toBe('Cursor');
  });
});
