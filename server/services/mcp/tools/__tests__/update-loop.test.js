import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createTestDb } from '../../../../test-utils/db.js';
import { ensureTestMockConfig } from '../../../../test-utils/agent-configs.js';
import { createUpdateLoopTool } from '../update-loop.js';
import {
  MOCK_SECONDARY_MODEL_ID,
  MOCK_STANDARD_MODEL_ID,
} from '../../../../../shared/mock-agent-sdk.js';
import {
  SUBAGENT_DEFAULT_ANY,
  SUBAGENT_DEFAULT_PRESET,
} from '../../../../../shared/subagent-default-mode.js';
import { MCP_AGENT_CREATED_MODEL_NOT_ALLOWED_ERROR } from '../../../agent-mcp-model-resolver.js';

const db = createTestDb();

describe('UpdateLoop MCP tool', () => {
  let userId;
  let configId;
  let patchSpy;

  function patchToolCtx(mode) {
    /** The tool schema mode comes from the authenticated user row; the resolver reads the same column from the db. */
    return { app, userId, user: { id: userId, subagent_default_mode: mode } };
  }

  const app = {
    get: () => db,
    service: (name) => {
      if (name === 'loops') {
        return { patch: (loopId, patch, params) => patchSpy(loopId, patch, params) };
      }
      if (name === 'users') {
        return { get: async (id) => db('users').where({ id }).first() };
      }
      if (name === 'agent-configs') {
        return {
          getSdkMeta: (sdk) => ({ key: sdk, servicePath: `${sdk}-agent` }),
        };
      }
      throw new Error(`unexpected service ${name}`);
    },
  };

  function payload(result) {
    return JSON.parse(result.content[0].text);
  }

  async function insertPreset(model = MOCK_SECONDARY_MODEL_ID) {
    const [presetId] = await db('agent_model_presets').insert({
      user_id: userId,
      description: 'Test preset',
      agent_config_id: configId,
      model,
    });
    return presetId;
  }

  beforeEach(async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
    await db('users').insert({ github_id: 71, username: 'update-loop', status: 'approved' });
    userId = (await db('users').where({ username: 'update-loop' }).first()).id;
    configId = await ensureTestMockConfig(db, userId);
    patchSpy = vi.fn().mockResolvedValue({ id: 7, name: 'loop' });
  });

  it('parse a patch without model fields in Presets-only mode', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    const tool = createUpdateLoopTool(patchToolCtx(SUBAGENT_DEFAULT_PRESET));
    expect(tool.schema.preset_model_id.safeParse(undefined).success).toBe(true);
    const parsed = z.object(tool.schema).safeParse({
      loop_id: 7,
      enabled: false,
      schedule_type: 'daily',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an unrelated patch in Presets-only mode without touching the loop model', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    const tool = createUpdateLoopTool(patchToolCtx(SUBAGENT_DEFAULT_PRESET));
    const result = payload(await tool.handler({ loop_id: 7, enabled: false }));
    expect(result.ok).toBe(true);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(7, { enabled: false }, expect.anything());
    const sent = patchSpy.mock.calls[0][1];
    expect(sent).not.toHaveProperty('agent_config_id');
    expect(sent).not.toHaveProperty('model');
    expect(sent).not.toHaveProperty('model_params');
  });

  it('accepts an unrelated patch in inherit mode without touching the loop model', async () => {
    const tool = createUpdateLoopTool(patchToolCtx(null));
    const result = payload(await tool.handler({ loop_id: 7, name: 'Renamed' }));
    expect(result.ok).toBe(true);
    expect(patchSpy).toHaveBeenCalledWith(7, { name: 'Renamed' }, expect.anything());
    expect(patchSpy.mock.calls[0][1]).not.toHaveProperty('model');
  });

  it('rewrites the loop model when preset_model_id is passed in Presets-only mode', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    const presetId = await insertPreset();
    const tool = createUpdateLoopTool(patchToolCtx(SUBAGENT_DEFAULT_PRESET));
    const result = payload(
      await tool.handler({ loop_id: 7, preset_model_id: presetId, name: 'New name' })
    );
    expect(result.ok).toBe(true);
    const sent = patchSpy.mock.calls[0][1];
    expect(sent).toEqual(
      expect.objectContaining({
        name: 'New name',
        agent_config_id: configId,
        agent_sdk: 'mock',
        model: MOCK_SECONDARY_MODEL_ID,
      })
    );
    expect(sent).not.toHaveProperty('preset_model_id');
  });

  it('rejects raw model fields when the policy is not Any preset or model', async () => {
    await db('users')
      .where({ id: userId })
      .update({ subagent_default_mode: SUBAGENT_DEFAULT_PRESET });
    const tool = createUpdateLoopTool(patchToolCtx(SUBAGENT_DEFAULT_PRESET));
    const result = payload(
      await tool.handler({
        loop_id: 7,
        agent_config_id: configId,
        model: MOCK_SECONDARY_MODEL_ID,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(MCP_AGENT_CREATED_MODEL_NOT_ALLOWED_ERROR);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('applies a raw model patch when the policy is Any preset or model', async () => {
    await db('users').where({ id: userId }).update({ subagent_default_mode: SUBAGENT_DEFAULT_ANY });
    const tool = createUpdateLoopTool(patchToolCtx(SUBAGENT_DEFAULT_ANY));
    const result = payload(
      await tool.handler({
        loop_id: 7,
        agent_config_id: configId,
        model: MOCK_STANDARD_MODEL_ID,
      })
    );
    expect(result.ok).toBe(true);
    const sent = patchSpy.mock.calls[0][1];
    expect(sent).toEqual(
      expect.objectContaining({
        agent_config_id: configId,
        agent_sdk: 'mock',
        model: MOCK_STANDARD_MODEL_ID,
      })
    );
    expect(sent).not.toHaveProperty('preset_model_id');
  }, 15000);
});
