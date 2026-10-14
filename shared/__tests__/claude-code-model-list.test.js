import { describe, it, expect } from 'vitest';
import {
  claudeCodePickerModelId,
  mapClaudeCodeSdkModelToListEntry,
  normalizeClaudeCodePickerModelId,
} from '../claude-code-model-list.js';
import { claudeCodeModelDisplayName } from '../claude-code-model-display.js';

describe('claudeCodePickerModelId', () => {
  it('uses value, not resolvedModel', () => {
    expect(
      claudeCodePickerModelId({
        value: 'default',
        resolvedModel: 'claude-opus-5[1m]',
      })
    ).toBe('default');
    expect(
      claudeCodePickerModelId({
        value: 'opus[1m]',
        resolvedModel: 'claude-opus-5[1m]',
      })
    ).toBe('opus[1m]');
  });
});

describe('normalizeClaudeCodePickerModelId', () => {
  const pickerIds = new Set(['default', 'opus[1m]', 'sonnet']);

  it('maps bogus default[1m] back to default', () => {
    expect(normalizeClaudeCodePickerModelId('default[1m]', pickerIds)).toBe('default');
  });

  it('keeps valid opus[1m]', () => {
    expect(normalizeClaudeCodePickerModelId('opus[1m]', pickerIds)).toBe('opus[1m]');
  });
});

describe('mapClaudeCodeSdkModelToListEntry', () => {
  it('includes resolved_model for debugging without using it as id', () => {
    const entry = mapClaudeCodeSdkModelToListEntry(
      {
        value: 'sonnet',
        resolvedModel: 'claude-sonnet-5-5',
        displayName: 'Sonnet',
        description: 'Sonnet 5 · Efficient',
      },
      claudeCodeModelDisplayName
    );
    expect(entry).toEqual({
      id: 'sonnet',
      display_name: 'Sonnet 5.5',
      description: 'Sonnet 5 · Efficient',
      resolved_model: 'claude-sonnet-5-5',
    });
  });
});
