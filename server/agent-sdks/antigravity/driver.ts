import type { AgentApp } from '../../services/feathers/agent-service-types.ts';
import type { AcpClientLike, AcpSessionWithModels } from '../acp/acp-client.ts';
import { AcpProcessDriver, type AcpProcessDriverConfig } from '../acp/acp-process-driver.ts';
import { buildAntigravityEnv, parseExtraEnvJson, resolveAgyBinary } from './env.js';
import {
  antigravityThoughtLevelFromModelParams,
  stripAntigravityThoughtSuffix,
} from './model-params.js';
import { recordAntigravityTurnUsage } from './record-turn-usage.js';

export async function applyAntigravitySessionModel({
  client,
  sessionId,
  sessionResult,
  model,
  modelParams,
}: {
  client: AcpClientLike;
  sessionId: string;
  sessionResult: AcpSessionWithModels;
  model: string;
  modelParams?: unknown;
}): Promise<void> {
  const thoughtLevel = antigravityThoughtLevelFromModelParams(modelParams);
  const baseId = stripAntigravityThoughtSuffix(model) || model;
  const availableModels = Array.isArray(sessionResult?.models?.availableModels)
    ? sessionResult.models.availableModels
    : [];
  const currentModelId = sessionResult?.models?.currentModelId ?? null;
  const availableIds = new Set(
    availableModels.map((m) => m?.modelId).filter((id): id is string => Boolean(id))
  );

  if (thoughtLevel) {
    const composed = `${baseId}-${thoughtLevel}`;
    if (availableIds.has(composed)) {
      if (currentModelId !== composed) {
        await client.setModel(sessionId, composed);
      }
      return;
    }
  }

  if (availableIds.has(model)) {
    if (currentModelId !== model) {
      await client.setModel(sessionId, model);
    }
    return;
  }

  const configOptions = Array.isArray(sessionResult?.configOptions)
    ? sessionResult.configOptions
    : [];
  const modelOpt = configOptions.find(
    (opt) => opt && (opt.id === 'model' || opt.category === 'model') && opt.type === 'select'
  );
  if (modelOpt) {
    await client.setConfigOption(sessionId, modelOpt.id, baseId);
    if (thoughtLevel) {
      const thoughtOpt = configOptions.find(
        (opt) =>
          opt &&
          (opt.id === 'thought_level' ||
            opt.id === 'reasoning' ||
            opt.category === 'thought_level') &&
          opt.type === 'select'
      );
      if (thoughtOpt) {
        await client.setConfigOption(sessionId, thoughtOpt.id, thoughtLevel);
      }
    }
    return;
  }

  const fallbackModel = thoughtLevel ? `${baseId}-${thoughtLevel}` : model;
  try {
    await client.setModel(sessionId, fallbackModel);
  } catch {
    await client.setConfigOption(sessionId, 'model', baseId);
  }
}

export function createAntigravityDriver(
  { app, config }: { app: AgentApp; config: Record<string, unknown> | null },
  overrides: Partial<AcpProcessDriverConfig> = {}
): AcpProcessDriver {
  return new AcpProcessDriver(
    {
      binary: (cfg) => {
        const extraEnv = parseExtraEnvJson(cfg?.extra_env as string | null | undefined);
        return resolveAgyBinary(extraEnv);
      },
      env: (cfg) => {
        const apiKey = typeof cfg?.api_key === 'string' ? cfg.api_key.trim() || null : null;
        const extraEnv = parseExtraEnvJson(cfg?.extra_env as string | null | undefined);
        return buildAntigravityEnv({ apiKey, extraEnv });
      },
      authMethod: 'gemini-api-key',
      systemPromptMetaKey: 'antigravity',
      applyModel: applyAntigravitySessionModel,
      recordTurnUsage: async (opts) => {
        await recordAntigravityTurnUsage(app, opts.session, opts.usage, {
          turnModel: opts.turnModel,
          patchSessionCost: opts.patchSessionCost,
          agentConfigId: opts.agentConfigId,
          agentId: opts.agentId,
        });
      },
      ...overrides,
    },
    config
  );
}
