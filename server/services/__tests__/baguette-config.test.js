/**
 * Unit tests for Baguette config helpers and loading.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getScriptBlock,
  appendTaskArgs,
  getAvailableTasks,
  getAvailableCommands,
  interpolateString,
  interpolateBaguetteConfig,
  interpolateDockerContainer,
  interpolateConfigTaskPorts,
  assertNoTaskPlaceholders,
  assertTaskEnvReferencesValid,
  resolveTaskEnv,
  TaskEnvInterpolationError,
  interpolateDockerContainerTaskPorts,
  buildDockerTaskHostnames,
  interpolateEnvTaskPorts,
  loadBaguetteConfig,
  readBaguetteConfigRaw,
  loadBaguetteInstructions,
  CONFIG_FILENAME,
  INSTRUCTIONS_REL_PATH,
} from '../baguette-config.js';

describe('getScriptBlock', () => {
  it('keeps a multi-line block intact instead of joining lines with &&', () => {
    const block = 'pnpm install:all\npnpm run migrate';
    expect(getScriptBlock(block)).toBe('pnpm install:all\npnpm run migrate');
  });

  it('preserves indentation so shell control flow survives', () => {
    const block = 'if [ -f .env ]; then\n  echo found\nfi';
    expect(getScriptBlock(block)).toBe(block);
  });

  it('strips trailing whitespace left by the YAML block scalar', () => {
    expect(getScriptBlock('pnpm test\n\n')).toBe('pnpm test');
  });

  it('returns null for empty, blank or non-string input', () => {
    expect(getScriptBlock('')).toBeNull();
    expect(getScriptBlock('   \n  ')).toBeNull();
    expect(getScriptBlock(null)).toBeNull();
    expect(getScriptBlock(undefined)).toBeNull();
    expect(getScriptBlock(42)).toBeNull();
  });
});

describe('appendTaskArgs', () => {
  it('appends args to a single-line command', () => {
    expect(appendTaskArgs('vitest run', ['src/foo.test.js'])).toBe('vitest run src/foo.test.js');
  });

  it('appends args to the last command of a multi-line script, not after it', () => {
    expect(appendTaskArgs('export CI=1\nvitest run', ['-t', 'my test'])).toBe(
      'export CI=1\nvitest run -t my test'
    );
  });

  it('ignores trailing blank lines when finding the last command', () => {
    expect(appendTaskArgs('vitest run\n\n', ['--bail'])).toBe('vitest run --bail\n\n');
  });

  it('returns the script unchanged when there are no args', () => {
    expect(appendTaskArgs('npm test', [])).toBe('npm test');
    expect(appendTaskArgs('npm test', undefined)).toBe('npm test');
    expect(appendTaskArgs('npm test', ['  '])).toBe('npm test');
  });
});

describe('getAvailableTasks', () => {
  it('exposes session.init as a multi-line baguette:init task', () => {
    const tasks = getAvailableTasks({
      session: { init: 'pnpm install:all\npnpm run migrate\n' },
    });
    expect(tasks['baguette:init'].run).toBe('pnpm install:all\npnpm run migrate');
  });

  it('keeps a multi-line task run block intact', () => {
    const tasks = getAvailableTasks({
      session: { tasks: { seed: { run: 'rm -f db.sqlite\npnpm run migrate\n' } } },
    });
    expect(tasks.seed.run).toBe('rm -f db.sqlite\npnpm run migrate');
  });

  it('skips tasks whose run block is blank', () => {
    const tasks = getAvailableTasks({ session: { tasks: { noop: { run: '  \n ' } } } });
    expect(tasks.noop).toBeUndefined();
  });

  it('preserves attach: false on tasks', () => {
    const tasks = getAvailableTasks({
      session: { tasks: { 'run-tests': { run: 'pnpm test', attach: false } } },
    });
    expect(tasks['run-tests'].attach).toBe(false);
  });

  it('preserves internal: true on tasks', () => {
    const tasks = getAvailableTasks({
      session: {
        tasks: {
          postgres: { type: 'docker', internal: true, container: { image: 'postgres:16' } },
          seed: { run: 'pnpm seed', internal: true },
        },
      },
    });
    expect(tasks.postgres.internal).toBe(true);
    expect(tasks.seed.internal).toBe(true);
  });

  it('interpolateEnvTaskPorts substitutes task port placeholders in env values', () => {
    const env = interpolateEnvTaskPorts(
      {
        DATABASE_URL: 'postgres://u:p@127.0.0.1:${{ baguette.tasks.postgres.PG_PORT }}/app',
      },
      { postgres: { PG_PORT: 55432 } }
    );
    expect(env.DATABASE_URL).toBe('postgres://u:p@127.0.0.1:55432/app');
  });

  it('includes docker tasks without ports', () => {
    const tasks = getAvailableTasks({
      session: {
        tasks: {
          postgres: {
            type: 'docker',
            env: { POSTGRES_USER: 'postgres' },
            container: {
              image: 'postgres:16',
              persist: ['/var/lib/postgresql/data'],
            },
          },
        },
      },
    });
    expect(tasks.postgres.type).toBe('docker');
    expect(tasks.postgres.ports).toBeUndefined();
    expect(tasks.postgres.env).toEqual({ POSTGRES_USER: 'postgres' });
  });

  it('assertNoTaskPlaceholders rejects session.env with task references', () => {
    expect(() =>
      assertNoTaskPlaceholders(
        { DB: 'postgres://${{ baguette.tasks.postgres.container_hostname }}:5432/app' },
        'session.env'
      )
    ).toThrow(TaskEnvInterpolationError);
  });

  it('assertTaskEnvReferencesValid rejects unknown task keys', () => {
    expect(() =>
      assertTaskEnvReferencesValid(
        { URL: '${{ baguette.tasks.missing.PORT }}' },
        new Set(['postgres'])
      )
    ).toThrow(/unknown task "missing"/);
  });

  it('assertTaskEnvReferencesValid rejects task refs not in depends-on', () => {
    expect(() =>
      assertTaskEnvReferencesValid(
        { URL: '${{ baguette.tasks.postgres.container_hostname }}' },
        new Set(['postgres', 'app']),
        ['postgres']
      )
    ).not.toThrow();
    expect(() =>
      assertTaskEnvReferencesValid(
        { URL: '${{ baguette.tasks.postgres.container_hostname }}' },
        new Set(['postgres', 'app']),
        []
      )
    ).toThrow(/depends-on/);
    expect(() =>
      assertTaskEnvReferencesValid(
        { URL: '${{ baguette.tasks.postgres.container_hostname }}' },
        new Set(['postgres', 'app']),
        ['other']
      )
    ).toThrow(/depends-on/);
  });

  it('resolveTaskEnv applies ports after depends-on', () => {
    const env = resolveTaskEnv(
      { TEST_URL: 'http://127.0.0.1:${{ baguette.tasks.dev.SERVER_PORT }}/' },
      {
        configTaskKeys: ['dev'],
        dependsOnKeys: ['dev'],
        portMap: { dev: { SERVER_PORT: 4321 } },
        interpolateOpts: { shortId: 'ab', secrets: {}, publicUri: '', servicesUriMap: {} },
      }
    );
    expect(env.TEST_URL).toBe('http://127.0.0.1:4321/');
  });

  it('resolveTaskEnv applies container_hostname from portMap after depends-on', () => {
    const env = resolveTaskEnv(
      {
        DATABASE_URL: 'postgres://u:p@${{ baguette.tasks.postgres.container_hostname }}:5432/app',
      },
      {
        configTaskKeys: ['postgres'],
        dependsOnKeys: ['postgres'],
        portMap: { postgres: { container_hostname: 'baguette_ab_postgres' } },
        interpolateOpts: {
          shortId: 'ab',
          secrets: {},
          publicUri: '',
          servicesUriMap: {},
          taskHostnames: {},
        },
      }
    );
    expect(env.DATABASE_URL).toBe('postgres://u:p@baguette_ab_postgres:5432/app');
  });

  it('resolveTaskEnv fails when depends-on port is missing', () => {
    expect(() =>
      resolveTaskEnv(
        { TEST_URL: '${{ baguette.tasks.dev.SERVER_PORT }}' },
        {
          configTaskKeys: ['dev'],
          dependsOnKeys: ['dev'],
          portMap: {},
          interpolateOpts: { shortId: 'ab', secrets: {}, publicUri: '', servicesUriMap: {} },
        }
      )
    ).toThrow(/not available/);
  });

  it('resolveTaskEnv fails when portMap lacks a referenced attr', () => {
    expect(() =>
      resolveTaskEnv(
        {
          TEST_URL:
            'http://${{ baguette.tasks.postgres.container_hostname }}:${{ baguette.tasks.dev.SERVER_PORT }}/',
        },
        {
          configTaskKeys: ['postgres', 'dev'],
          dependsOnKeys: ['postgres', 'dev'],
          portMap: { postgres: { container_hostname: 'baguette_ab_postgres' } },
          interpolateOpts: { shortId: 'ab', secrets: {}, publicUri: '', servicesUriMap: {} },
        }
      )
    ).toThrow(/not available/);
  });

  it('interpolateString leaves host-port placeholders for interpolateConfigTaskPorts', () => {
    const cmd = 'http://127.0.0.1:${{ baguette.tasks.dev-server.VITE_PORT }}';
    expect(interpolateString(cmd, { shortId: 'x', secrets: {}, publicUri: '' })).toBe(cmd);
    expect(interpolateConfigTaskPorts(cmd, { 'dev-server': { VITE_PORT: 5173 } })).toBe(
      'http://127.0.0.1:5173'
    );
  });

  it('interpolateBaguetteConfig walks nested config strings', () => {
    const opts = { shortId: 'ab12', secrets: { DB_PASS: 'secret' }, publicUri: 'http://ab12.test' };
    const out = interpolateBaguetteConfig(
      {
        session: {
          env: { LABEL: 'sess-${{ baguette.session.short_id }}' },
          tasks: {
            db: {
              container: {
                image: 'app:${{ baguette.session.short_id }}',
                build: { args: { TOKEN: '${{ baguette.secrets.DB_PASS }}' } },
              },
            },
          },
        },
      },
      opts
    );
    expect(out.session.env.LABEL).toBe('sess-ab12');
    expect(out.session.tasks.db.container.image).toBe('app:ab12');
    expect(out.session.tasks.db.container.build.args.TOKEN).toBe('secret');
  });

  it('interpolateDockerContainer substitutes session placeholders in image and build', () => {
    const opts = { shortId: 'a3de4', secrets: { REGISTRY_TOKEN: 'tok' }, publicUri: '' };
    const container = interpolateDockerContainer(
      {
        image: 'fabricate:baguette-test-${{ baguette.session.short_id }}',
        build: {
          context: '.',
          args: { SESSION: '${{ baguette.session.short_id }}' },
        },
        persist: ['/data/${{ baguette.session.short_id }}'],
      },
      opts
    );
    expect(container.image).toBe('fabricate:baguette-test-a3de4');
    expect(container.build.args.SESSION).toBe('a3de4');
    expect(container.persist).toEqual(['/data/a3de4']);
  });

  it('interpolateDockerContainer substitutes placeholders in container.command', () => {
    const opts = { shortId: 'a3de4', secrets: {}, publicUri: '' };
    const container = interpolateDockerContainer(
      {
        image: 'postgres:16',
        command: 'postgres -c max_connections=${{ baguette.session.short_id }}',
      },
      opts
    );
    expect(container.command).toBe('postgres -c max_connections=a3de4');
  });

  it('interpolateDockerContainerTaskPorts substitutes host ports in container.command', () => {
    const container = interpolateDockerContainerTaskPorts(
      {
        image: 'app:dev',
        command: 'serve --port ${{ baguette.tasks.dev-server.VITE_PORT }}',
      },
      { 'dev-server': { VITE_PORT: 5173 } }
    );
    expect(container.command).toBe('serve --port 5173');
  });

  it('buildDockerTaskHostnames and interpolateString resolve container_hostname', () => {
    const config = {
      session: {
        tasks: { postgres: { type: 'docker', container: { image: 'postgres:16' } } },
      },
    };
    const hostnames = buildDockerTaskHostnames(config, 'a3de4');
    expect(hostnames.postgres).toBe('baguette_a3de4_postgres');
    const url = interpolateString(
      'postgres://u:p@${{ baguette.tasks.postgres.container_hostname }}:5432/app',
      { taskHostnames: hostnames }
    );
    expect(url).toBe('postgres://u:p@baguette_a3de4_postgres:5432/app');
  });
});

describe('getAvailableCommands', () => {
  it('omits tasks with internal: true', () => {
    const commands = getAvailableCommands({
      session: {
        tasks: {
          'run-tests': { run: 'pnpm test' },
          postgres: {
            type: 'docker',
            internal: true,
            container: { image: 'postgres:16' },
          },
          seed: { run: 'pnpm seed', internal: true },
        },
      },
    });
    expect(commands.map((c) => c.label)).toEqual(['run-tests']);
  });
});

describe('loadBaguetteConfig', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-config-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads .baguette.yaml', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, CONFIG_FILENAME),
      'config:\n  session:\n    tasks:\n      test:\n        run: echo hi\n'
    );
    const config = await loadBaguetteConfig(tmpDir);
    expect(config.session.tasks.test.run).toBe('echo hi');
  });

  it('accepts a top-level config object without a config: wrapper', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, CONFIG_FILENAME),
      'session:\n  init: pnpm install\n'
    );
    const config = await loadBaguetteConfig(tmpDir);
    expect(config.session.init).toBe('pnpm install');
  });

  it('returns null when no config file exists', async () => {
    expect(await loadBaguetteConfig(tmpDir)).toBeNull();
  });
});

describe('readBaguetteConfigRaw', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-raw-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns raw yaml text', async () => {
    const text = 'session:\n  init: pnpm install\n';
    await fs.promises.writeFile(path.join(tmpDir, CONFIG_FILENAME), text);
    expect(await readBaguetteConfigRaw(tmpDir)).toEqual({ yaml: text });
  });

  it('returns missing when no config file exists', async () => {
    expect(await readBaguetteConfigRaw(tmpDir)).toEqual({ missing: true });
  });
});

describe('loadBaguetteInstructions', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-instr-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads .baguette/instructions.md', async () => {
    await fs.promises.mkdir(path.join(tmpDir, '.baguette'), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, INSTRUCTIONS_REL_PATH), 'Use tabs.\n');
    expect(await loadBaguetteInstructions(tmpDir)).toBe('Use tabs.');
  });

  it('returns null when instructions file is missing', async () => {
    expect(await loadBaguetteInstructions(tmpDir)).toBeNull();
  });
});
