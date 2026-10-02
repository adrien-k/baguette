import { describe, it, expect } from 'vitest';
import {
  isTaskActive,
  isTaskRunTimerActive,
  isTaskStoppable,
  isTaskTerminal,
} from '../task-status.js';

describe('task-status', () => {
  it('classifies terminal and active statuses', () => {
    expect(isTaskTerminal('exited')).toBe(true);
    expect(isTaskTerminal('stopped')).toBe(true);
    expect(isTaskTerminal('running')).toBe(false);

    expect(isTaskActive('waiting')).toBe(true);
    expect(isTaskActive('exiting')).toBe(true);
    expect(isTaskActive('stopped')).toBe(false);
  });

  it('only runs the timer while status is running', () => {
    expect(isTaskRunTimerActive('running')).toBe(true);
    expect(isTaskRunTimerActive('waiting')).toBe(false);
    expect(isTaskRunTimerActive('exiting')).toBe(false);
  });

  it('allows stop while waiting or running', () => {
    expect(isTaskStoppable('waiting')).toBe(true);
    expect(isTaskStoppable('running')).toBe(true);
    expect(isTaskStoppable('exiting')).toBe(false);
  });
});
