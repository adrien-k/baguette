import { describe, it, expect } from 'vitest';
import {
  issueFixAgentPrompt,
  issuesFixAllAgentPrompt,
  sortIssuesBySeverity,
} from '../session-issues.js';

describe('issue fix agent prompts', () => {
  it('does not embed issue title or description in the single-issue prompt', () => {
    const text = issueFixAgentPrompt(
      { id: 7, severity: 'high', title: 'Leaky title', description: 'Secret body' },
      99
    );
    expect(text).toContain('issue #7');
    expect(text).toContain('ReadIssue with issue_id 7');
    expect(text).not.toContain('Leaky title');
    expect(text).not.toContain('Secret body');
  });

  it('references ListIssues for fix-all', () => {
    const text = issuesFixAllAgentPrompt(42);
    expect(text).toContain('ListIssues with status "submitted"');
    expect(text).toContain('session_id 42');
    expect(text).toContain('one separate git commit per issue');
    expect(text).toContain('fixed together easily');
  });
});

describe('sortIssuesBySeverity', () => {
  it('orders critical before high before medium before low', () => {
    const sorted = sortIssuesBySeverity([
      { id: 1, severity: 'low' },
      { id: 2, severity: 'critical' },
      { id: 3, severity: 'medium' },
      { id: 4, severity: 'high' },
    ]);
    expect(sorted.map((i) => i.severity)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('puts opened before submitted and resolved, then ignored', () => {
    const sorted = sortIssuesBySeverity([
      { id: 1, severity: 'critical', status: 'ignored' },
      { id: 2, severity: 'low', status: 'opened' },
      { id: 3, severity: 'high', status: 'resolved' },
      { id: 4, severity: 'critical', status: 'submitted' },
    ]);
    expect(sorted.map((i) => i.id)).toEqual([2, 4, 3, 1]);
  });

  it('puts opened issues above higher-severity submitted issues', () => {
    const sorted = sortIssuesBySeverity([
      { id: 1, severity: 'critical', status: 'submitted' },
      { id: 2, severity: 'low', status: 'opened' },
    ]);
    expect(sorted.map((i) => i.id)).toEqual([2, 1]);
  });

  it('orders opened before submitted at the same severity', () => {
    const sorted = sortIssuesBySeverity([
      { id: 1, severity: 'high', status: 'submitted' },
      { id: 2, severity: 'high', status: 'opened' },
    ]);
    expect(sorted.map((i) => i.id)).toEqual([2, 1]);
  });

  it('breaks ties by id ascending', () => {
    const sorted = sortIssuesBySeverity([
      { id: 10, severity: 'high' },
      { id: 2, severity: 'high' },
    ]);
    expect(sorted.map((i) => i.id)).toEqual([2, 10]);
  });
});
