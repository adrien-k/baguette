import { describe, it, expect } from 'vitest';
import {
  findRunningTaskByLabel,
  findSessionTaskById,
  resolveOpenTaskFromMcpTool,
  resolveTaskTargetFromMcpTool,
} from '../taskMcpTool.js';

const tasks = [
  { id: 10, label: 'run-tests', task_key: 'run-tests', status: 'exited' },
  { id: 11, label: 'dev-server', task_key: 'dev-server', status: 'running' },
  { id: 12, label: 'run-tests', task_key: 'run-tests', status: 'waiting' },
];

describe('resolveTaskTargetFromMcpTool', () => {
  it('reads taskId and label from RunTask result', () => {
    expect(
      resolveTaskTargetFromMcpTool(
        'RunTask',
        { label: 'run-tests' },
        { ok: true, taskId: 12, label: 'run-tests', status: 'waiting' }
      )
    ).toEqual({ taskId: 12, label: 'run-tests' });
  });

  it('uses AwaitDetachedTask args when result is missing', () => {
    expect(resolveTaskTargetFromMcpTool('AwaitDetachedTask', { taskId: 11 }, null)).toEqual({
      taskId: 11,
      label: null,
    });
  });

  it('falls back to RunTask args label', () => {
    expect(resolveTaskTargetFromMcpTool('RunTask', { label: 'lint' }, null)).toEqual({
      taskId: null,
      label: 'lint',
    });
  });
});

describe('findSessionTaskById', () => {
  it('matches by id', () => {
    expect(findSessionTaskById(tasks, 11)).toEqual(tasks[1]);
  });
});

describe('findRunningTaskByLabel', () => {
  it('prefers an active task with the same label', () => {
    expect(findRunningTaskByLabel(tasks, 'run-tests')).toEqual(tasks[2]);
  });

  it('picks the highest id when none are active, regardless of array order', () => {
    const finished = [
      { id: 3, label: 'run-tests', task_key: 'run-tests', status: 'exited' },
      { id: 9, label: 'run-tests', task_key: 'run-tests', status: 'exited' },
      { id: 1, label: 'run-tests', task_key: 'run-tests', status: 'exited' },
    ];
    expect(findRunningTaskByLabel(finished, 'run-tests')).toEqual(finished[1]);
  });

  it('does not match a config task by label when task_key differs', () => {
    const mixed = [
      { id: 1, label: 'build', task_key: 'compile', status: 'running' },
      { id: 2, label: 'build', task_key: null, status: 'exited' },
    ];
    expect(findRunningTaskByLabel(mixed, 'build')).toEqual(mixed[1]);
  });
});

describe('resolveOpenTaskFromMcpTool', () => {
  it('opens a RunTask result by taskId', () => {
    expect(
      resolveOpenTaskFromMcpTool(tasks, 'RunTask', { label: 'run-tests' }, { taskId: 10 })
    ).toEqual(tasks[0]);
  });

  it('matches a running RunTask by label while the tool is in flight', () => {
    expect(
      resolveOpenTaskFromMcpTool(tasks, 'RunTask', { label: 'dev-server' }, null, {
        isRunning: true,
      })
    ).toEqual(tasks[1]);
  });

  it('returns a synthetic task when the id is known but not in the session list', () => {
    expect(
      resolveOpenTaskFromMcpTool([], 'AwaitDetachedTask', { taskId: 99 }, { taskId: 99 })
    ).toEqual({ id: 99, label: null });
  });
});
