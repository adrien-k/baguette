import { describe, expect, it } from 'vitest';
import { createClaudeTaskTracker, extractClaudeTaskIdFromResult } from '../claude-task-tracker.js';

describe('extractClaudeTaskIdFromResult', () => {
  it('parses Task #N from a string result', () => {
    expect(extractClaudeTaskIdFromResult('Task #3 created')).toBe('3');
  });

  it('reads task.id from JSON', () => {
    expect(extractClaudeTaskIdFromResult({ task: { id: 7 } })).toBe('7');
  });
});

describe('createClaudeTaskTracker', () => {
  it('fills TaskUpdate subject/description from TaskCreate when update is status-only', () => {
    const tracker = createClaudeTaskTracker();
    tracker.registerTaskFromCreateResult('Task #1 created', {
      subject: 'Fix todos',
      description: 'Hide empty rows',
    });
    const enriched = tracker.enrichTaskUpdateInput({ taskId: '1', status: 'completed' });
    expect(enriched).toMatchObject({
      taskId: '1',
      status: 'completed',
      subject: 'Fix todos',
      description: 'Hide empty rows',
    });
  });

  it('does not overwrite explicit TaskUpdate text', () => {
    const tracker = createClaudeTaskTracker();
    tracker.registerTaskFromCreateResult('Task #2 created', { subject: 'Old' });
    const enriched = tracker.enrichTaskUpdateInput({
      taskId: '2',
      status: 'in_progress',
      subject: 'New title',
    });
    expect(enriched.subject).toBe('New title');
  });
});
