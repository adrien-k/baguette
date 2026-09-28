import { describe, it, expect } from 'vitest';
import { sortIssuesBySeverity } from '../session-issues.js';

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

  it('puts ignored issues after opened and resolved', () => {
    const sorted = sortIssuesBySeverity([
      { id: 1, severity: 'critical', status: 'ignored' },
      { id: 2, severity: 'low', status: 'opened' },
      { id: 3, severity: 'high', status: 'resolved' },
    ]);
    expect(sorted.map((i) => i.id)).toEqual([3, 2, 1]);
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
