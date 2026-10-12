import { describe, it, expect } from 'vitest';
import { normalizeAgentConfigLogo, resolveAgentConfigLogoId } from '../agent-config-logo.js';

describe('agent-config-logo', () => {
  it('resolves null logo to sdk Lobe mark', () => {
    expect(resolveAgentConfigLogoId(null, 'claude')).toBe('ClaudeCode');
    expect(resolveAgentConfigLogoId(null, 'cursor')).toBe('Cursor');
    expect(resolveAgentConfigLogoId('', 'pi')).toBe('Pi');
  });

  it('prefers explicit logo over sdk', () => {
    expect(resolveAgentConfigLogoId('OpenRouter', 'claude')).toBe('OpenRouter');
  });

  it('normalizes empty to null', () => {
    expect(normalizeAgentConfigLogo(null)).toBeNull();
    expect(normalizeAgentConfigLogo('OpenRouter')).toBe('OpenRouter');
    expect(normalizeAgentConfigLogo('LunaRoute')).toBe('LunaRoute');
  });

  it('rejects unknown logos', () => {
    expect(() => normalizeAgentConfigLogo('unknown-gateway')).toThrow(/logo must be/);
    expect(() => normalizeAgentConfigLogo('openrouter')).toThrow(/logo must be/);
  });
});
