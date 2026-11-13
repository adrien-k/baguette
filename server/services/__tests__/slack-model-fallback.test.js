/**
 * Provider and model choice for sessions started from Slack.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

const listModels = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../feathers/agent-configs.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listModelsForOwnedConfig: listModels.fn,
}));

import {
  createSlackModelResolver,
  describeChoice,
  mediumEffortParams,
  pickCheapCandidate,
  pickModelNamedInText,
  resolveSlackModelChoice,
  versionOf,
} from '../slack-model-fallback.js';
import { MCP_BUILDER_MODEL_SETTINGS_ERROR } from '../agent-mcp-model-resolver.js';
import { insertUser } from './slack-test-helpers.js';

const db = createTestDb();
const app = { get: () => db };

const cand = (id, display_name, config = { id: 1, sdk: 'claude' }, variants) => ({
  config,
  model: { id, display_name, variants },
});
const effortVariants = (...levels) =>
  levels.map((value) => ({
    params: [
      { id: 'effort', value },
      { id: 'context', value: '200k' },
    ],
  }));

describe('pickCheapCandidate', () => {
  const pick = (...ids) => pickCheapCandidate(ids.map((id) => cand(id)))?.model.id;

  it('prefers haiku, then luna, then qwen, then other small models', () => {
    expect(pick('claude-opus-4-7', 'qwen-3', 'claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(pick('claude-opus-4-7', 'qwen-3', 'luna-1')).toBe('luna-1');
    expect(pick('claude-opus-4-7', 'qwen-3')).toBe('qwen-3');
    expect(pick('big-model', 'gpt-mini')).toBe('gpt-mini');
  });

  it('falls back to whatever is available, and to null when there is nothing', () => {
    expect(pick('claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(pickCheapCandidate([])).toBeNull();
  });
});

describe('mediumEffortParams', () => {
  it('chooses the medium variant, keeping its other params', () => {
    expect(mediumEffortParams({ variants: effortVariants('low', 'medium', 'high') })).toEqual([
      { id: 'effort', value: 'medium' },
      { id: 'context', value: '200k' },
    ]);
  });

  it('uses the nearest tier when there is no medium', () => {
    expect(mediumEffortParams({ variants: effortVariants('low', 'high') })).toEqual([
      { id: 'effort', value: 'low' },
      { id: 'context', value: '200k' },
    ]);
  });

  it('understands reasoning_effort too', () => {
    const variants = [{ params: [{ id: 'reasoning_effort', value: 'medium' }] }];
    expect(mediumEffortParams({ variants })).toEqual([{ id: 'reasoning_effort', value: 'medium' }]);
  });

  it('is null for models without effort settings', () => {
    expect(mediumEffortParams({ variants: [] })).toBeNull();
    expect(mediumEffortParams({})).toBeNull();
    expect(
      mediumEffortParams({ variants: [{ params: [{ id: 'fast', value: 'true' }] }] })
    ).toBeNull();
  });
});

describe('versionOf', () => {
  it.each([
    [{ display_name: 'Composer 2.5' }, [2, 5]],
    [{ id: 'claude-sonnet-4-5' }, [4, 5]],
    [{ display_name: 'Grok 4.6', id: 'x' }, [4, 6]],
    [{ id: 'sonnet' }, []],
  ])('%j → %j', (model, version) => {
    expect(versionOf(model)).toEqual(version);
  });
});

describe('pickModelNamedInText', () => {
  const cursor = { id: 2, sdk: 'cursor' };
  const models = [
    cand('grok-4-6', 'Grok 4.6', cursor),
    cand('composer-1', 'Composer 1', cursor),
    cand('composer-2', 'Composer 2', cursor),
    cand('composer-2-5', 'Composer 2.5', cursor),
    cand('gpt-5', 'GPT-5', cursor),
  ];
  const named = (text, list = models) =>
    pickModelNamedInText(list, text)?.model.display_name ?? null;

  it('picks the newest version when only the family is named', () => {
    expect(named('use composer for this')).toBe('Composer 2.5');
  });

  it('honours a version given in the message', () => {
    expect(named('composer 2 please')).toBe('Composer 2');
    expect(named('try composer 2.5')).toBe('Composer 2.5');
    expect(named('grok 4.6 should do')).toBe('Grok 4.6');
  });

  it('matches a model id, too', () => {
    expect(named('run it on gpt-5')).toBe('GPT-5');
  });

  it('returns null when no model is named', () => {
    expect(named('fix the login bug')).toBeNull();
  });

  it('ignores words every model of a config shares', () => {
    const claude = [
      cand('claude-opus-4-7', 'Opus 4.7'),
      cand('claude-sonnet-4-5', 'Sonnet 4.5'),
      cand('claude-haiku-4-5', 'Haiku 4.5'),
    ];
    expect(named('fix the claude bug', claude)).toBeNull();
    expect(named('use sonnet to fix it', claude)).toBe('Sonnet 4.5');
    expect(named('try haiku 4.5', claude)).toBe('Haiku 4.5');
  });
});

describe('describeChoice', () => {
  it('shows the provider and the model’s display name', () => {
    expect(
      describeChoice({ agent_sdk: 'cursor', model: 'grok-4-6', model_label: 'Grok 4.6' })
    ).toBe('cursor, Grok 4.6');
    expect(describeChoice({ agent_sdk: 'claude', model: 'haiku' })).toBe('claude, haiku');
  });
});

describe('resolveSlackModelChoice', () => {
  const claudeModels = [
    { id: 'opus', display_name: 'Opus' },
    { id: 'haiku', display_name: 'Haiku', variants: effortVariants('low', 'medium', 'high') },
  ];
  const cursorModels = [
    { id: 'grok-4-6', display_name: 'Grok 4.6' },
    { id: 'composer-2-5', display_name: 'Composer 2.5' },
    { id: 'composer-1', display_name: 'Composer 1' },
  ];

  async function setup({ withCursor = true } = {}) {
    const userId = await insertUser(db);
    const claudeId = await insertTestAgentConfig(db, userId, { sdk: 'claude', label: 'Claude' });
    const cursorId = withCursor
      ? await insertTestAgentConfig(db, userId, { sdk: 'cursor', label: 'Cursor' })
      : null;
    listModels.fn.mockImplementation(async (_app, { configId }) => {
      if (configId === claudeId) return { models: claudeModels };
      if (configId === cursorId) return { models: cursorModels };
      throw new Error('unknown config');
    });
    return { userId, claudeId, cursorId };
  }

  beforeEach(() => {
    listModels.fn.mockReset();
  });

  it('uses the model the message names, wherever it lives', async () => {
    const { userId, cursorId } = await setup();
    const choice = await resolveSlackModelChoice(app, userId, 'use composer to fix the test');
    expect(choice).toMatchObject({
      agent_config_id: cursorId,
      agent_sdk: 'cursor',
      model: 'composer-2-5',
      model_label: 'Composer 2.5',
    });
  });

  it('applies medium effort to a named model that has effort levels', async () => {
    const { userId, claudeId } = await setup();
    const choice = await resolveSlackModelChoice(app, userId, 'ask haiku');
    expect(choice).toMatchObject({ agent_config_id: claudeId, model: 'haiku' });
    expect(choice.model_params).toEqual([
      { id: 'effort', value: 'medium' },
      { id: 'context', value: '200k' },
    ]);
  });

  it('uses a provider named by its label, with its cheapest model', async () => {
    const { userId, cursorId } = await setup();
    const choice = await resolveSlackModelChoice(app, userId, 'do it in cursor please');
    expect(choice.agent_config_id).toBe(cursorId);
    expect(['grok-4-6', 'composer-2-5', 'composer-1']).toContain(choice.model);
  });

  it('prefers the provider’s default model when one is set', async () => {
    const { userId, cursorId } = await setup();
    await db('agent_configs')
      .where({ id: cursorId })
      .update({ default_model: JSON.stringify({ model: 'composer-1' }) });
    expect((await resolveSlackModelChoice(app, userId, 'in cursor')).model).toBe('composer-1');
  });

  it('keeps a model name within a named provider', async () => {
    const { userId } = await setup();
    const choice = await resolveSlackModelChoice(app, userId, 'cursor, grok');
    expect(choice).toMatchObject({ agent_sdk: 'cursor', model: 'grok-4-6' });
  });

  it('falls back to the cheapest available model when nothing is named', async () => {
    const { userId, claudeId } = await setup();
    const choice = await resolveSlackModelChoice(app, userId, 'fix the login bug');
    expect(choice).toMatchObject({ agent_config_id: claudeId, model: 'haiku' });
    expect(choice.model_params).toContainEqual({ id: 'effort', value: 'medium' });
  });

  it('prefers the user’s default session model over the cheapest', async () => {
    const { userId, claudeId } = await setup();
    await db('users')
      .where({ id: userId })
      .update({
        agent_default_config_id: claudeId,
        agent_default_model: JSON.stringify({ model: 'opus' }),
      });
    const choice = await resolveSlackModelChoice(app, userId, 'fix the login bug');
    expect(choice).toMatchObject({ agent_config_id: claudeId, model: 'opus' });
  });

  it('skips a config whose models cannot be listed', async () => {
    const { userId, claudeId } = await setup();
    listModels.fn.mockImplementation(async (_app, { configId }) => {
      if (configId === claudeId) return { models: claudeModels };
      throw new Error('bad credentials');
    });
    expect((await resolveSlackModelChoice(app, userId, 'fix it')).agent_config_id).toBe(claudeId);
  });

  it('reports the usual "configure a default" error when there is nothing to choose from', async () => {
    const userId = await insertUser(db);
    await expect(resolveSlackModelChoice(app, userId, 'fix it')).rejects.toThrow(
      MCP_BUILDER_MODEL_SETTINGS_ERROR
    );
    await insertTestAgentConfig(db, userId, { sdk: 'claude' });
    listModels.fn.mockResolvedValue({ models: [] });
    await expect(resolveSlackModelChoice(app, userId, 'fix it')).rejects.toThrow(
      MCP_BUILDER_MODEL_SETTINGS_ERROR
    );
  });
});

describe('createSlackModelResolver', () => {
  it('rethrows errors that are not the "no default" error', async () => {
    const resolver = createSlackModelResolver(app);
    const userId = await insertUser(db);
    await expect(resolver(db, userId, { preset_model_id: 999 })).rejects.toThrow(
      'Preset model not found'
    );
  });
});
