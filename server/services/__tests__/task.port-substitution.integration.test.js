/**
 * Integration test: port substitution when a task depends on another task.
 *
 * Verifies that `${{ baguette.tasks.<key>.<PORT> }}` placeholders in a task's
 * command are replaced with the actual allocated port numbers before the shell
 * sees the command.  Without the fix this produces "Bad substitution" because
 * the raw `${{` syntax is not valid POSIX sh.
 *
 * Tests at the Task + TasksService level with a minimal mock Feathers app so
 * this file has no dependency on better-sqlite3 / the DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setTimeout as delay } from 'timers/promises';

import { TasksService } from '../feathers/tasks.service.js';
import { interpolateTaskPorts } from '../baguette-config.js';

// ── Mock loadBaguetteConfig ────────────────────────────────────────────────
// Keep getAvailableTasks / interpolateTaskPorts as real implementations so
// the substitution logic itself is exercised.
vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue({
      session: {
        tasks: {
          'http-server': {
            run: "node -e \"const h=require('http');h.createServer((_,r)=>r.end('pong')).listen(parseInt(process.env.SERVER_PORT,10),()=>process.stdout.write('listening\\n'))\"",
            ports: ['SERVER_PORT'],
          },
          'http-client': {
            // The ${{ }} placeholder must survive as a literal string so
            // interpolateTaskPorts can replace it at runtime.
            run: "node -e \"require('http').get('http://127.0.0.1:${{ baguette.tasks.http-server.SERVER_PORT }}',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{process.stdout.write('response:'+d+'\\n');process.exit(0)})}).on('error',e=>{process.stderr.write(e.message+'\\n');process.exit(1)})\"",
            'depends-on': ['http-server'],
          },
          'env-client': {
            run: 'node -e "process.stdout.write(process.env.TEST_URL||\'\')"',
            'depends-on': ['http-server'],
            env: {
              TEST_URL: 'http://127.0.0.1:${{ baguette.tasks.http-server.SERVER_PORT }}/',
            },
          },
        },
      },
    }),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function waitFor(pred, { timeoutMs = 10_000, intervalMs = 100, msg = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timeout after ${timeoutMs}ms. ${msg}`);
}

/** Build a minimal stub Feathers app that satisfies tasks.service.create. */
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
  return {
    service: (name) => {
      if (name === 'sessions') {
        return {
          get: async () => sessionRow,
          getTaskEnv: async () => ({ ...process.env }),
          getInterpolateOpts: async () => ({
            shortId: 'tst',
            secrets: {},
            publicUri: 'http://tst.localhost',
            servicesUriMap: {},
            taskHostnames: {},
          }),
          getInterpolatedCommand: async (_sessionId, command) => command,
        };
      }
      if (name === 'tasks') return service;
      throw new Error(`Unknown service: ${name}`);
    },
    get: () => null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('task port substitution (integration)', () => {
  let service;
  let runningTasks;

  beforeEach(() => {
    service = new TasksService();
    // In real use Feathers registers an EventEmitter-based emit; add a stub for tests.
    service.emit = () => {};
    runningTasks = [];
  });

  afterEach(async () => {
    // Kill any live child processes created during the test.
    await service.killAllTasks();
    // Also kill tasks started directly via Task (server).
    await Promise.all(runningTasks.map((t) => t.kill().catch(() => {})));
  });

  it('substitutes the dependency port before spawning the client task', async () => {
    service.app = buildMockApp(service);

    // Command contains the raw ${{ }} placeholder — same as what the UI sends.
    const clientCommand =
      "node -e \"require('http').get('http://127.0.0.1:${{ baguette.tasks.http-server.SERVER_PORT }}',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{process.stdout.write('response:'+d+'\\n');process.exit(0)})}).on('error',e=>{process.stderr.write(e.message+'\\n');process.exit(1)})\"";

    // create() will auto-start the http-server dependency, wait for its
    // port, substitute the placeholder, then spawn the client.
    const clientPub = await service.create(
      {
        session_id: 1,
        command: clientCommand,
        label: 'http-client',
        task_key: 'http-client', // ← the fix: this triggers dependency resolution
      },
      { user: { id: 1 } } // internal call — no provider, bypasses only() hook
    );

    // Wait for the client task to exit.
    await waitFor(() => service.getTask(clientPub.id)?.status === 'exited', {
      timeoutMs: 15_000,
      msg: () => `client logs: ${service.getTask(clientPub.id)?.getLogs()}`,
    });

    const clientTask = service.getTask(clientPub.id);
    expect(clientTask.exit_code).toBe(0);
    expect(clientTask.getLogs()).toContain('response:pong');
  }, 20_000);

  it('reuses a preview webserver task (same task key) for depends-on port substitution', async () => {
    service.app = buildMockApp(service);

    const serverPub = await service.create(
      { session_id: 1, task_key: 'http-server', autoStart: true },
      { user: { id: 1 } }
    );
    const serverTask = service.getTask(serverPub.id);
    await waitFor(() => Object.keys(serverTask.ports).length === 1, {
      timeoutMs: 15_000,
      msg: () => `server logs: ${serverTask.getLogs()}`,
    });
    await serverTask.waitForReady({ timeoutMs: 15_000 });

    const clientPub = await service.create(
      { session_id: 1, task_key: 'http-client' },
      { user: { id: 1 } }
    );
    await waitFor(() => service.getTask(clientPub.id)?.status === 'exited', {
      timeoutMs: 15_000,
      msg: () => `client logs: ${service.getTask(clientPub.id)?.getLogs()}`,
    });

    const clientTask = service.getTask(clientPub.id);
    expect(clientTask.exit_code).toBe(0);
    expect(clientTask.getLogs()).toContain('response:pong');
    expect([...service._tasks.values()].filter((t) => t.task_key === 'http-server')).toHaveLength(
      1
    );
  }, 30_000);

  it('reuses an already-running dependency and still substitutes its ports', async () => {
    service.app = buildMockApp(service);

    const serverPub = await service.create(
      { session_id: 1, task_key: 'http-server' },
      { user: { id: 1 } }
    );
    const serverTask = service.getTask(serverPub.id);
    await waitFor(() => Object.keys(serverTask.ports).length === 1, {
      timeoutMs: 15_000,
      msg: () => `server logs: ${serverTask.getLogs()}`,
    });
    await serverTask.waitForReady({ timeoutMs: 15_000 });

    const clientPub = await service.create(
      { session_id: 1, task_key: 'http-client' },
      { user: { id: 1 } }
    );
    await waitFor(() => service.getTask(clientPub.id)?.status === 'exited', {
      timeoutMs: 15_000,
      msg: () => `client logs: ${service.getTask(clientPub.id)?.getLogs()}`,
    });

    const clientTask = service.getTask(clientPub.id);
    expect(clientTask.exit_code).toBe(0);
    expect(clientTask.getLogs()).toContain('response:pong');
    expect([...service._tasks.values()].filter((t) => t.label === 'http-server')).toHaveLength(1);
  }, 30_000);

  it('substitutes task port placeholders in env after depends-on tasks are ready', async () => {
    service.app = buildMockApp(service);

    const pub = await service.create(
      { session_id: 1, task_key: 'env-client' },
      { user: { id: 1 } }
    );

    await waitFor(() => service.getTask(pub.id)?.status === 'exited', {
      timeoutMs: 15_000,
      msg: () => service.getTask(pub.id)?.getLogs(),
    });

    const task = service.getTask(pub.id);
    const serverTask = [...service._tasks.values()].find((t) => t.label === 'http-server');
    expect(serverTask?.ports?.SERVER_PORT).toBeTruthy();
    expect(task.getLogs()).toContain(`http://127.0.0.1:${serverTask.ports.SERVER_PORT}/`);
  }, 20_000);

  it('does NOT substitute ports when task_key is omitted — shell receives bad substitution', async () => {
    service.app = buildMockApp(service);

    // Omit task_key — no dependency resolution, placeholder reaches the shell.
    const clientPub = await service.create(
      {
        session_id: 1,
        command:
          "node -e \"require('http').get('http://127.0.0.1:${{ baguette.tasks.http-server.SERVER_PORT }}',r=>{process.exit(0)}).on('error',e=>{process.exit(1)})\"",
        label: 'http-client-no-key',
        // task_key intentionally absent
      },
      { user: { id: 1 } }
    );

    await waitFor(() => service.getTask(clientPub.id)?.status === 'exited', { timeoutMs: 10_000 });

    const clientTask = service.getTask(clientPub.id);
    // Without substitution the command fails (bad substitution or unreachable port).
    expect(clientTask.exit_code).not.toBe(0);
  }, 15_000);

  it('interpolateTaskPorts replaces all ${{ baguette.tasks.KEY.PORT }} placeholders', () => {
    const portMap = { 'my-server': { HTTP_PORT: 54321, WS_PORT: 54322 } };
    const cmd =
      'BACKEND=http://localhost:${{ baguette.tasks.my-server.HTTP_PORT }} WS=ws://localhost:${{ baguette.tasks.my-server.WS_PORT }} node app.js';
    const result = interpolateTaskPorts(cmd, portMap);
    expect(result).toBe('BACKEND=http://localhost:54321 WS=ws://localhost:54322 node app.js');
  });

  it('interpolateTaskPorts leaves the string unchanged when no placeholders match', () => {
    const cmd = 'node app.js --port 3000';
    expect(interpolateTaskPorts(cmd, {})).toBe(cmd);
  });
});
