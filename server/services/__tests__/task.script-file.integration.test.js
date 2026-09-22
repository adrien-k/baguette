/**
 * Integration tests for multi-line task commands.
 *
 * A multi-line `run:` block is written to a script file and executed, rather than being
 * collapsed into a single `cmd1 && cmd2` string. That keeps shell control flow, heredocs
 * and comments working, and makes `set -e` (not `&&`) the thing that stops the script.
 *
 * Uses real child processes — no child_process mocking.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setTimeout as delay } from 'timers/promises';
import { readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Task } from '../task.js';

const SCRIPT_DIR = join(tmpdir(), 'baguette-tasks');

async function waitFor(pred, { timeoutMs = 8_000, intervalMs = 50, msg = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms. ${msg}`);
}

describe('Task multi-line scripts (integration)', () => {
  const runningTasks = [];

  const run = async (id, command) => {
    const task = new Task({ id, sessionId: 1, command, env: process.env, cwd: '/tmp' });
    runningTasks.push(task);
    await task.start();
    await waitFor(() => task.status === 'exited', { msg: () => task.getLogs() });
    return task;
  };

  afterEach(async () => {
    await Promise.all(runningTasks.splice(0).map((t) => t.kill().catch(() => {})));
  });

  it('runs a block whose shell control flow spans several lines', async () => {
    // `if …; then / echo / fi` joined with && is a syntax error; as a script it works.
    const task = await run(1, 'if [ -d /tmp ]; then\n  echo inside-if\nfi\necho after-if');
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('inside-if');
    expect(task.getLogs()).toContain('after-if');
  });

  it('keeps comment lines from breaking the rest of the block', async () => {
    // With && joining, `# comment && echo second` comments out everything after it.
    const task = await run(2, '# a comment\necho second-line');
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('second-line');
  });

  it('stops at the first failing line via set -e', async () => {
    const task = await run(3, 'echo before\nfalse\necho after');
    expect(task.exit_code).not.toBe(0);
    expect(task.getLogs()).toContain('before');
    expect(task.getLogs()).not.toContain('after');
  });

  it('carries shell state (variables, cwd) across lines', async () => {
    const task = await run(4, 'GREETING=hello\ncd /tmp\necho "$GREETING from $(pwd)"');
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('hello from /tmp');
  });

  it('honours a user-supplied shebang', async () => {
    const task = await run(5, '#!/bin/sh\necho shebang-honoured\n');
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('shebang-honoured');
  });

  it('deletes the script file after the process exits', async () => {
    const task = await run(6, 'echo cleanup-check\ntrue');
    expect(task.exit_code).toBe(0);
    // unlink is fire-and-forget on exit, so poll rather than asserting straight away.
    let leftover = true;
    for (let i = 0; i < 40 && leftover; i++) {
      const files = await readdir(SCRIPT_DIR).catch(() => []);
      leftover = files.some((f) => f.startsWith('task-6-'));
      if (leftover) await delay(50);
    }
    expect(leftover).toBe(false);
  });

  it('still runs single-line commands without a script file', async () => {
    const task = await run(7, 'echo single-line');
    expect(task.exit_code).toBe(0);
    expect(task.getLogs()).toContain('single-line');
    const files = await readdir(SCRIPT_DIR).catch(() => []);
    expect(files.some((f) => f.startsWith('task-7-'))).toBe(false);
  });
});
