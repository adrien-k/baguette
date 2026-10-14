import { describe, it, expect } from 'vitest';
import {
  claudeCodeModelDisplayName,
  displayNameFromClaudeWireModelId,
} from '../claude-code-model-display.js';

describe('claudeCodeModelDisplayName', () => {
  it('appends version from description headline for family aliases', () => {
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Sonnet',
        description: 'Sonnet 5 · Efficient for routine tasks · $2/$10 per Mtok',
      })
    ).toBe('Sonnet 5');
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Haiku',
        description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
      })
    ).toBe('Haiku 4.5');
  });

  it('includes version for full model ids with short display names', () => {
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Fable',
        description: 'Fable 5 · Most capable for your hardest and longest-running tasks',
      })
    ).toBe('Fable 5');
  });

  it('uses richer headline for context variants', () => {
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Opus (1M context)',
        description: 'Opus 5 with 1M context · Best for everyday, complex tasks · $5/$25 per Mtok',
      })
    ).toBe('Opus 5 with 1M context');
  });

  it('keeps default row label when headline is not a version line', () => {
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Default (recommended)',
        description: 'Use the default model (currently Opus 5 (1M context)) · $5/$25 per Mtok',
      })
    ).toBe('Default (recommended)');
  });

  it('falls back to displayName without description', () => {
    expect(claudeCodeModelDisplayName({ displayName: 'Sonnet', description: null })).toBe('Sonnet');
  });

  it('uses resolvedModel for patch versions when description only has major', () => {
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Sonnet',
        description: 'Sonnet 5 · Efficient for routine tasks · $2/$10 per Mtok',
        resolvedModel: 'claude-sonnet-5-5',
      })
    ).toBe('Sonnet 5.5');
  });

  it('uses resolvedModel when description is missing', () => {
    expect(
      claudeCodeModelDisplayName({
        displayName: 'Sonnet',
        description: null,
        resolvedModel: 'claude-sonnet-5-5',
      })
    ).toBe('Sonnet 5.5');
  });
});

describe('displayNameFromClaudeWireModelId', () => {
  it('formats Anthropic wire ids', () => {
    expect(displayNameFromClaudeWireModelId('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(displayNameFromClaudeWireModelId('claude-opus-5[1m]')).toBe('Opus 5 with 1M context');
    expect(displayNameFromClaudeWireModelId('claude-haiku-4-5')).toBe('Haiku 4.5');
  });
});
