import { describe, it, expect } from 'vitest';
import {
  compareTasksByName,
  groupTasksForPanel,
  parseTaskNamespace,
  taskDisplayName,
  taskRowTitle,
} from '../taskPanelGrouping.js';

describe('parseTaskNamespace', () => {
  it('splits on the first colon only', () => {
    expect(parseTaskNamespace('docker:postgres:16')).toEqual({
      namespace: 'docker',
      localName: 'postgres:16',
    });
    expect(parseTaskNamespace('baguette:init')).toEqual({
      namespace: 'baguette',
      localName: 'init',
    });
  });

  it('returns null namespace when there is no prefix', () => {
    expect(parseTaskNamespace('run-tests')).toEqual({
      namespace: null,
      localName: 'run-tests',
    });
  });
});

describe('groupTasksForPanel', () => {
  it('sorts by name and groups namespaced tasks', () => {
    const tasks = [
      { id: 1, label: 'zebra' },
      { id: 2, label: 'docker:redis' },
      { id: 3, label: 'alpha' },
      { id: 4, label: 'baguette:init' },
      { id: 5, label: 'docker:postgres' },
    ];
    const { ungrouped, namespaces } = groupTasksForPanel(tasks);
    expect(ungrouped.map((t) => t.label)).toEqual(['alpha', 'zebra']);
    expect(namespaces).toEqual([
      { namespace: 'baguette', tasks: [{ id: 4, label: 'baguette:init' }] },
      {
        namespace: 'docker',
        tasks: [
          { id: 5, label: 'docker:postgres' },
          { id: 2, label: 'docker:redis' },
        ],
      },
    ]);
  });

  it('uses command when label is missing', () => {
    expect(taskDisplayName({ command: 'docker:img' })).toBe('docker:img');
    expect(compareTasksByName({ label: 'b' }, { label: 'a' })).toBeGreaterThan(0);
  });
});

describe('taskRowTitle', () => {
  it('shortens names inside a namespace subgroup', () => {
    expect(taskRowTitle({ label: 'docker:postgres' }, true)).toBe('postgres');
    expect(taskRowTitle({ label: 'run-tests' }, false)).toBe('run-tests');
  });
});
