import { describe, it, expect } from 'vitest';
import {
  registerSdkPlugin,
  getSdkPlugin,
  listSdkPlugins,
  servicePathForSdk,
  sdkPluginPublicMeta,
  storedSessionIdColumns,
} from '../registry.js';
import { claudeAgentSdkPlugin } from '../claude/index.js';
import { cursorAgentSdkPlugin } from '../cursor/index.js';
import { piAgentSdkPlugin } from '../pi/index.js';
import { mockAgentSdkPlugin } from '../mock/index.js';
import {
  ANTHROPIC_API_KEY_ENV,
  CLAUDE_API_KEY_ENV_OPTIONS,
} from '../../../shared/agent-config-api-key-env.js';
import { LUNAROUTE_PI_API_KEY_ENV_VAR } from '../../../shared/pi-api-key-env-vars.js';

const claudePlugin = {
  key: 'claude',
  label: 'Claude',
  servicePath: 'claude-agent',
  storedSessionIdColumn: 'claude_session_id',
};
const mockPlugin = {
  key: 'mock',
  label: 'Mock',
  servicePath: 'mock-agent',
  storedSessionIdColumn: null,
};

describe('agent SDK plugin registry', () => {
  it('registers plugins in order and returns registered objects', () => {
    registerSdkPlugin(claudePlugin);
    registerSdkPlugin(mockPlugin);

    expect(listSdkPlugins().map((p) => p.key)).toEqual(['claude', 'mock']);
    expect(getSdkPlugin('claude')).toBe(claudePlugin);
    expect(getSdkPlugin('mock')).toBe(mockPlugin);
  });

  it('re-registering a key is idempotent (first registration wins)', () => {
    registerSdkPlugin({ key: 'pi', label: 'First', servicePath: 'first-agent' });
    const again = registerSdkPlugin({ key: 'pi', label: 'Second', servicePath: 'second-agent' });

    expect(again.label).toBe('First');
    expect(getSdkPlugin('pi').servicePath).toBe('first-agent');
    expect(listSdkPlugins().filter((p) => p.key === 'pi')).toHaveLength(1);
  });

  it('rejects plugins without a key', () => {
    expect(() => registerSdkPlugin({ label: 'NoKey' })).toThrow(/plugin\.key is required/);
  });

  it('resolves service paths with first-registered fallback', () => {
    registerSdkPlugin(claudePlugin);
    registerSdkPlugin(mockPlugin);

    expect(servicePathForSdk('claude')).toBe('claude-agent');
    expect(servicePathForSdk('mock')).toBe('mock-agent');
    expect(servicePathForSdk('unknown')).toBe('claude-agent');
    expect(servicePathForSdk(null)).toBe('claude-agent');
  });

  it('registers a plugin that omits capability fields', () => {
    const minimal = { key: 'future', label: 'Future', servicePath: 'future-agent' };
    expect(registerSdkPlugin(minimal)).toBe(minimal);
    expect(getSdkPlugin('future')).toBe(minimal);
    expect(sdkPluginPublicMeta(minimal)).toEqual({
      key: 'future',
      label: 'Future',
      servicePath: 'future-agent',
      service_path: 'future-agent',
      supportsModelParams: false,
      requiresModelParamsOnTurn: false,
      usesAgentPricingTable: false,
      appliesUserModelPrefs: false,
      storedSessionIdColumn: null,
      requiresApiKey: true,
      credentialSchema: null,
    });
  });
});

describe('built-in SDK plugin contract', () => {
  it('exposes capability flags and credentialSchema on each plugin', () => {
    expect(claudeAgentSdkPlugin).toMatchObject({
      supportsModelParams: true,
      requiresModelParamsOnTurn: false,
      usesAgentPricingTable: false,
      storedSessionIdColumn: 'claude_session_id',
    });
    expect(claudeAgentSdkPlugin.credentialSchema).toMatchObject({
      envVarOptions: CLAUDE_API_KEY_ENV_OPTIONS,
      defaultEnvVar: ANTHROPIC_API_KEY_ENV,
      hasApiUrl: true,
      secretPlaceholder: 'sk-ant-…',
    });

    expect(cursorAgentSdkPlugin).toMatchObject({
      supportsModelParams: true,
      requiresModelParamsOnTurn: true,
      usesAgentPricingTable: true,
      appliesUserModelPrefs: true,
      storedSessionIdColumn: 'cursor_agent_id',
    });
    expect(typeof claudeAgentSdkPlugin.normalizeApiUrl).toBe('function');
    expect(cursorAgentSdkPlugin.credentialSchema).toMatchObject({
      envVarOptions: null,
      defaultEnvVar: null,
      hasApiUrl: false,
      secretPlaceholder: 'cursor-…',
    });

    expect(piAgentSdkPlugin).toMatchObject({
      supportsModelParams: true,
      requiresModelParamsOnTurn: false,
      usesAgentPricingTable: true,
      storedSessionIdColumn: 'pi_session_id',
    });
    expect(piAgentSdkPlugin.credentialSchema.envVarOptions.length).toBeGreaterThan(0);
    expect(piAgentSdkPlugin.credentialSchema.secretPlaceholder).toBe('provider API key');
    expect(
      piAgentSdkPlugin.credentialSchema.secretPlaceholderByEnvVar[LUNAROUTE_PI_API_KEY_ENV_VAR]
    ).toBe('lr_…');
    expect(piAgentSdkPlugin.credentialSchema.hasApiUrl).toBe(false);

    expect(mockAgentSdkPlugin).toMatchObject({
      requiresApiKey: false,
      supportsModelParams: false,
      requiresModelParamsOnTurn: false,
      usesAgentPricingTable: false,
      storedSessionIdColumn: null,
    });
  });

  it('hasStoredSession and normalizePickerModelId match each SDK', () => {
    expect(claudeAgentSdkPlugin.hasStoredSession({ claude_session_id: 'sess' })).toBe(true);
    expect(claudeAgentSdkPlugin.hasStoredSession({})).toBe(false);
    expect(claudeAgentSdkPlugin.normalizePickerModelId('opus[1m]', new Set(['opus']))).toBe('opus');

    expect(cursorAgentSdkPlugin.hasStoredSession({ cursor_agent_id: 'bc-1' })).toBe(true);
    expect(cursorAgentSdkPlugin.normalizePickerModelId('opus[1m]', new Set(['opus']))).toBe(
      'opus[1m]'
    );
    expect(
      cursorAgentSdkPlugin.usageLabelExtras({
        model_params: JSON.stringify([{ id: 'fast', value: 'true' }]),
      })
    ).toEqual({ fast: true });
    expect(claudeAgentSdkPlugin.usageLabelExtras).toBeUndefined();
    expect(typeof claudeAgentSdkPlugin.resetUsageTotals).toBe('function');

    expect(piAgentSdkPlugin.hasStoredSession({ pi_session_id: 'pi-1' })).toBe(true);
    expect(mockAgentSdkPlugin.hasStoredSession({ claude_session_id: 'sess' })).toBe(false);
    expect(mockAgentSdkPlugin.adaptTools([{ name: 'x' }])).toEqual([]);
  });

  it('omits functions from sdkPluginPublicMeta', () => {
    const meta = sdkPluginPublicMeta(claudeAgentSdkPlugin);
    expect(meta.adaptTools).toBeUndefined();
    expect(meta.hasStoredSession).toBeUndefined();
    expect(meta.normalizePickerModelId).toBeUndefined();
    expect(meta.normalizeApiUrl).toBeUndefined();
    expect(meta.credentialSchema.hasApiUrl).toBe(true);
    expect(meta.supportsModelParams).toBe(true);
    expect(meta.appliesUserModelPrefs).toBe(false);
  });

  it('storedSessionIdColumns skips plugins with a null column', () => {
    registerSdkPlugin({
      key: 'col-a',
      label: 'A',
      servicePath: 'a-agent',
      storedSessionIdColumn: 'col_a',
    });
    registerSdkPlugin({
      key: 'col-b',
      label: 'B',
      servicePath: 'b-agent',
      storedSessionIdColumn: 'col_b',
    });
    registerSdkPlugin({
      key: 'col-none',
      label: 'N',
      servicePath: 'n-agent',
      storedSessionIdColumn: null,
    });
    const cols = storedSessionIdColumns();
    expect(cols).toEqual(expect.arrayContaining(['col_a', 'col_b']));
    expect(cols).not.toContain(null);
    expect(cols).not.toContain(undefined);
  });
});
