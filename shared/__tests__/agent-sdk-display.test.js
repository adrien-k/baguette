import { describe, expect, it } from 'vitest';
import { formatAgentSdkDisplayName } from '../agent-sdk-display.js';

describe('formatAgentSdkDisplayName', () => {
  it('capitalizes known SDK ids', () => {
    expect(formatAgentSdkDisplayName('claude')).toBe('Claude');
    expect(formatAgentSdkDisplayName('cursor')).toBe('Cursor');
    expect(formatAgentSdkDisplayName('pi')).toBe('Pi');
  });

  it('returns Agent when sdk is missing', () => {
    expect(formatAgentSdkDisplayName(null)).toBe('Agent');
    expect(formatAgentSdkDisplayName('')).toBe('Agent');
  });
});
