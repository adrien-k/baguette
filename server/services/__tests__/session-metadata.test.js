import { describe, it, expect, vi } from 'vitest';
import {
  branchNameFromLabel,
  buildMetadataPrompt,
  completeSessionMetadata,
  labelFromCompletionText,
  METADATA_TIMEOUT_MS,
} from '../session-metadata.js';

describe('buildMetadataPrompt', () => {
  it('embeds the task and asks for a title only', () => {
    const prompt = buildMetadataPrompt('Fix the login redirect');
    expect(prompt).toContain('Fix the login redirect');
    expect(prompt).toMatch(/Output ONLY the title/i);
    expect(prompt).not.toContain('branch');
  });
});

describe('labelFromCompletionText', () => {
  it('keeps a plain completion', () => {
    expect(labelFromCompletionText('Fix login redirect')).toBe('Fix login redirect');
  });

  it('takes the first non-empty line', () => {
    expect(labelFromCompletionText('\n  Fix login redirect  \nSecond line\n')).toBe(
      'Fix login redirect'
    );
  });

  it('strips code fences, quotes, bullets, and trailing periods', () => {
    expect(labelFromCompletionText('```\n"Fix login redirect."\n```')).toBe('Fix login redirect');
    expect(labelFromCompletionText('- Fix login redirect')).toBe('Fix login redirect');
    expect(labelFromCompletionText("'Fix login redirect'")).toBe('Fix login redirect');
  });

  it('caps the label at 80 characters', () => {
    const long = 'x'.repeat(120);
    expect(labelFromCompletionText(long)).toHaveLength(80);
  });

  it('returns empty for unusable completions', () => {
    expect(labelFromCompletionText('')).toBe('');
    expect(labelFromCompletionText(null)).toBe('');
    expect(labelFromCompletionText('``` ```')).toBe('');
  });
});

describe('branchNameFromLabel', () => {
  it('kebab-cases the label and appends the short id', () => {
    expect(branchNameFromLabel('Fix login redirect', 'abc12')).toBe('fix-login-redirect-abc12');
  });

  it('strips punctuation and collapses separators', () => {
    expect(branchNameFromLabel('Fix: login / redirect!!', 'abc12')).toBe(
      'fix-login-redirect-abc12'
    );
  });

  it('caps the base so label + suffix stays within 60 characters', () => {
    const branch = branchNameFromLabel('x'.repeat(80), 'abcdefghij');
    expect(branch).toHaveLength(60);
    expect(branch.endsWith('-abcdefghij')).toBe(true);
    expect(branch.startsWith('xxx')).toBe(true);
  });

  it('falls back to task-<shortId> when nothing kebab-cases', () => {
    expect(branchNameFromLabel('', 'abc12')).toBe('task-abc12');
    expect(branchNameFromLabel('未定義のタスク', 'abc12')).toBe('task-abc12');
  });
});

describe('completeSessionMetadata', () => {
  it('sends the generic prompt and derives label + branch from the raw text', async () => {
    const service = { completeText: vi.fn().mockResolvedValue('Fix login redirect.') };
    const result = await completeSessionMetadata(service, {
      taskPrompt: 'Fix the login redirect',
      userId: 7,
      agentConfigId: 3,
      model: 'utility-cheap',
      modelParams: null,
      shortId: 'abc12',
    });
    expect(result).toEqual({ label: 'Fix login redirect', branchName: 'fix-login-redirect-abc12' });
    // shortId is used for the branch suffix only — it is not forwarded to the SDK.
    expect(service.completeText).toHaveBeenCalledWith(
      expect.stringContaining('Fix the login redirect'),
      {
        userId: 7,
        agentConfigId: 3,
        model: 'utility-cheap',
        modelParams: null,
      }
    );
  });

  it('falls back to defaults when the SDK cannot complete', async () => {
    const service = { completeText: vi.fn().mockResolvedValue('') };
    const result = await completeSessionMetadata(service, {
      taskPrompt: 'Fix the bug',
      shortId: 'abc12',
    });
    expect(result).toEqual({ label: '', branchName: 'task-abc12' });
  });

  it('exposes the shared completion budget', () => {
    expect(METADATA_TIMEOUT_MS).toBe(30_000);
  });
});
