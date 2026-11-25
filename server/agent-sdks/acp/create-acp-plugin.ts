import { acpToolCallBuilders } from '../acp-mapping.ts';
import { registerGenericAgentService } from '../generic-agent-service.ts';
import type { StoredSessionIdColumn } from '../../services/agent-service-lifecycle.ts';
import type { AgentApp } from '../../services/feathers/agent-service-types.ts';
import { AcpProcessDriver, type AcpProcessDriverConfig } from './acp-process-driver.ts';

export type CreateAcpPluginOptions = {
  key: string;
  label: string;
  servicePath?: string;
  binary: AcpProcessDriverConfig['binary'];
  args?: string[];
  env?: AcpProcessDriverConfig['env'];
  authMethod?: string | null;
  modelSelection?: 'setModel' | 'configOption';
  systemPromptMetaKey?: string;
  storedSessionIdColumn?: StoredSessionIdColumn | null;
  requiresApiKey?: boolean;
  supportsModelParams?: boolean;
  usesAgentPricingTable?: boolean;
  credentialSchema?: {
    envVarOptions: Array<{ value: string; label: string }> | null;
    defaultEnvVar: string | null;
    hasApiUrl: boolean;
    secretPlaceholder: string;
    secretPlaceholderByEnvVar?: Record<string, string> | null;
    credentialHelpBanner?: string;
  };
  listModels?: (
    config: Record<string, unknown>,
    opts?: { refresh?: boolean; user?: unknown }
  ) => Promise<{ models: unknown[]; rejected_models?: unknown[] }>;
  clearModelsCache?: (config: Record<string, unknown>) => Promise<void> | void;
  testConnectivity?: (config: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Config-only factory for any ACP-compatible agent CLI (`gemini --experimental-acp`,
 * `opencode acp`, `codex-acp`, …). Produces a full Baguette SDK plugin backed by
 * `GenericAgentService` + `AcpProcessDriver` without writing any service code.
 */
export function createAcpPlugin(opts: CreateAcpPluginOptions) {
  const servicePath = opts.servicePath ?? `${opts.key}-agent`;
  const storedCol = opts.storedSessionIdColumn ?? null;

  return {
    key: opts.key,
    label: opts.label,
    servicePath,

    supportsModelParams: opts.supportsModelParams ?? false,
    requiresModelParamsOnTurn: false,
    usesAgentPricingTable: opts.usesAgentPricingTable ?? false,
    storedSessionIdColumn: storedCol,
    requiresApiKey: opts.requiresApiKey ?? true,

    credentialSchema: opts.credentialSchema ?? {
      envVarOptions: null,
      defaultEnvVar: null,
      hasApiUrl: false,
      secretPlaceholder: 'API key',
      secretPlaceholderByEnvVar: null,
    },

    register(app: AgentApp, { servicePath: overridePath }: { servicePath?: string } = {}) {
      registerGenericAgentService(
        app,
        {
          key: opts.key,
          label: opts.label,
          servicePath,
          storedSessionIdColumn: storedCol,
          registerCompactionHook: true,
          createDriver: ({ config }) =>
            new AcpProcessDriver(
              {
                binary: opts.binary,
                args: opts.args,
                env: opts.env,
                authMethod: opts.authMethod,
                modelSelection: opts.modelSelection ?? 'setModel',
                systemPromptMetaKey: opts.systemPromptMetaKey ?? opts.key,
              },
              config
            ),
        },
        overridePath ?? servicePath
      );
    },

    async listModels(
      config: Record<string, unknown>,
      listOpts: { refresh?: boolean; user?: unknown } = {}
    ) {
      if (opts.listModels) return opts.listModels(config, listOpts);
      return { models: [], rejected_models: [] };
    },

    clearModelsCache(config: Record<string, unknown>) {
      return opts.clearModelsCache?.(config);
    },

    async testConnectivity(config: Record<string, unknown>) {
      if (opts.testConnectivity) return opts.testConnectivity(config);
      return { ok: true, checks: [{ id: opts.key, label: opts.label, ok: true }] };
    },

    toolCallBuilders() {
      return acpToolCallBuilders();
    },

    resolveModelParams() {
      return [];
    },

    adaptTools(genericToolList: unknown) {
      return genericToolList;
    },

    hasStoredSession(agent: Record<string, unknown> | null | undefined) {
      return storedCol ? Boolean(agent?.[storedCol]) : false;
    },

    normalizePickerModelId(id: string) {
      return id;
    },
  };
}
