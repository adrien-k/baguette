import { describe, it, expect } from 'vitest';
import {
  configCommandButtonLabel,
  groupConfigCommandsForPanel,
  parseTaskNamespace,
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

describe('groupConfigCommandsForPanel', () => {
  it('sorts by label and groups namespaced commands', () => {
    const commands = [
      { label: 'zebra', run: 'z' },
      { label: 'docker:redis', run: 'r' },
      { label: 'alpha', run: 'a' },
      { label: 'baguette:init', run: 'i' },
      { label: 'docker:postgres', run: 'p' },
    ];
    const { ungrouped, namespaces } = groupConfigCommandsForPanel(commands);
    expect(ungrouped.map((c) => c.label)).toEqual(['alpha', 'zebra']);
    expect(namespaces).toEqual([
      { namespace: 'baguette', items: [{ label: 'baguette:init', run: 'i' }] },
      {
        namespace: 'docker',
        items: [
          { label: 'docker:postgres', run: 'p' },
          { label: 'docker:redis', run: 'r' },
        ],
      },
    ]);
  });
});

describe('configCommandButtonLabel', () => {
  it('shortens labels inside a namespace subgroup', () => {
    expect(configCommandButtonLabel({ label: 'docker:postgres' }, true)).toBe('postgres');
    expect(configCommandButtonLabel({ label: 'run-tests' }, false)).toBe('run-tests');
  });
});
