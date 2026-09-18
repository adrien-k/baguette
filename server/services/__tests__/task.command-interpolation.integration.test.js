/**
 * Integration test: secret interpolation in task command strings.
 *
 * Verifies that `${{ baguette.secrets.KEY }}` placeholders in a task's
 * command are replaced with secret values before the shell sees the command.
 * Without the fix this produces "bad substitution" because `${{` is not
 * valid POSIX sh syntax.
 *
 * Also verifies that quoted forms like `"${{ baguette.secrets.KEY }}"` work
 * correctly: the quotes are shell syntax around the already-substituted value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setTimeout as delay } from 'timers/promises';

import { TasksService } from '../feathers/tasks.service.js';
import { interpolateString } from '../baguette-config.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue({ session: { tasks: {} } }),
  };
});

const TEST_SECRETS = {
  NO_QUOTE: 'plain_value',
  QUOTE: 'value with spaces',
};

async function waitFor(pred, { timeoutMs = 10_000, intervalMs = 100, msg = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timeout after ${timeoutMs}ms. ${msg}`);
}

function buildMockApp(service) {
  const sessionRow = {
    id: 1,
    user_id: 1,
    worktree_path: 'repos/test/worktree',
    absolute_worktree_path: '/tmp',
    initialized: true,
    archived_at: null,
    short_id: 'tst',
  };
  const interpolateOpts = {
    shortId: 'tst',
    secrets: TEST_SECRETS,
    publicUri: 'http://tst.localhost',
    servicesUriMap: {},
  };
  return {
    service: (name) => {
      if (name === 'sessions') {
        return {
          get: async () => sessionRow,
          getTaskEnv: async () => ({ ...process.env }),
          getInterpolatedCommand: async (_sessionId, command) =>
            interpolateString(command, interpolateOpts),
        };
      }
      if (name === 'tasks') return service;
      throw new Error(`Unknown service: ${name}`);
    },
    get: () => null,
  };
}

describe('task command interpolation (integration)', () => {
  let service;

  beforeEach(() => {
    service = new TasksService();
    service.emit = () => {};
  });

  afterEach(async () => {
    await service.killAllTasks();
  });

  it('substitutes ${{ baguette.secrets.* }} placeholders in the command before spawning', async () => {
    service.app = buildMockApp(service);

    // Shell-inline env vars: one unquoted, one double-quoted.
    // After interpolation the shell sees:
    //   NO_QUOTE=plain_value QUOTE="value with spaces" env
    const pub = await service.create(
      {
        session_id: 1,
        command:
          'NO_QUOTE=${{ baguette.secrets.NO_QUOTE }} QUOTE="${{ baguette.secrets.QUOTE }}" env',
        label: 'secret-interp',
      },
      { user: { id: 1 } }
    );

    await waitFor(() => service.getTask(pub.id)?.status === 'exited', {
      timeoutMs: 10_000,
      msg: () => service.getTask(pub.id)?.getLogs(),
    });

    const task = service.getTask(pub.id);
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('NO_QUOTE=plain_value');
    expect(task.getLogs()).toContain('QUOTE=value with spaces');
  }, 15_000);

  it('leaves the command unchanged when no ${{ }} placeholders are present', async () => {
    service.app = buildMockApp(service);

    const pub = await service.create(
      {
        session_id: 1,
        command: 'echo hello',
        label: 'no-placeholders',
      },
      { user: { id: 1 } }
    );

    await waitFor(() => service.getTask(pub.id)?.status === 'exited', { timeoutMs: 10_000 });

    const task = service.getTask(pub.id);
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('hello');
  }, 10_000);
});
