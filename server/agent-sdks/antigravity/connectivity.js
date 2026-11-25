import os from 'node:os';
import { AcpProcessClient } from '../acp/acp-client.ts';
import { buildAntigravityEnv, parseExtraEnvJson, resolveAgyBinary } from './env.js';
import { mapAcpSessionModels, openEphemeralAcpSession } from './models.js';

const ANTIGRAVITY_TEST_TIMEOUT_MS = 25_000;

function isAuthError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.code === -32000) return true;
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return msg.includes('authentication required') || msg.includes('auth required');
}

function formatCliError(err, binary) {
  if (err && typeof err === 'object' && err.code === 'ENOENT') {
    return `Antigravity CLI (${binary}) not found. Install agy or set ANTIGRAVITY_BIN in Extra env.`;
  }
  return err?.message ?? 'Failed to start Antigravity CLI';
}

function modelsCheckDetail(count) {
  if (count <= 0) return 'No models returned';
  return count === 1 ? '1 model available' : `${count} models available`;
}

/**
 * Validate Antigravity ACP CLI availability, authentication, and model catalog.
 *
 * @param {object | null | undefined} config
 * @param {{ spawnClient?: Function, timeoutMs?: number }} [opts]
 */
export async function runAntigravityConnectivityTest(
  config,
  { spawnClient, timeoutMs = ANTIGRAVITY_TEST_TIMEOUT_MS } = {}
) {
  const extraEnv = parseExtraEnvJson(config?.extra_env_json);
  const binary = resolveAgyBinary(extraEnv);
  const env = buildAntigravityEnv(config);
  const apiKey = typeof config?.api_key === 'string' ? config.api_key.trim() : '';

  const client = spawnClient
    ? spawnClient({ binary, cwd: os.tmpdir(), env })
    : AcpProcessClient.spawn({ binary, cwd: os.tmpdir(), env });

  let timer;
  const runProbe = async () => {
    const { init, sessionResult } = await openEphemeralAcpSession(client, {
      apiKey: apiKey || null,
      cwd: os.tmpdir(),
    });
    if (sessionResult?.sessionId) {
      await client.closeSession(sessionResult.sessionId);
    }
    return { init, sessionResult };
  };

  try {
    const { init, sessionResult } = await Promise.race([
      runProbe(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs
        );
      }),
    ]);

    const agentName = init?.agentInfo?.name ?? 'Antigravity ACP Server';
    const agentVersion = init?.agentInfo?.version ? ` v${init.agentInfo.version}` : '';
    const models = mapAcpSessionModels(sessionResult);
    const modelIds = models.map((m) => m.id);
    const checks = [
      {
        id: 'cli',
        label: 'Antigravity CLI (agy)',
        ok: true,
        detail: `${agentName}${agentVersion}`,
      },
      {
        id: 'auth',
        label: 'Authentication',
        ok: true,
        detail: apiKey ? 'Using Gemini API key' : 'Using local agy credentials',
      },
      {
        id: 'models',
        label: 'Models',
        ok: modelIds.length > 0 ? true : null,
        detail: modelsCheckDetail(modelIds.length),
      },
    ];
    const required = checks.filter((c) => c.ok !== null);
    return { ok: required.every((c) => c.ok), models: modelIds, checks };
  } catch (err) {
    if (isAuthError(err)) {
      return {
        ok: false,
        models: [],
        checks: [
          { id: 'cli', label: 'Antigravity CLI (agy)', ok: true },
          {
            id: 'auth',
            label: 'Authentication',
            ok: false,
            detail:
              'Authentication required. Run "agy acp --login" locally or provide a Gemini API key.',
          },
        ],
      };
    }
    return {
      ok: false,
      models: [],
      checks: [
        {
          id: 'cli',
          label: 'Antigravity CLI (agy)',
          ok: false,
          detail: formatCliError(err, binary),
        },
      ],
    };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close();
  }
}
