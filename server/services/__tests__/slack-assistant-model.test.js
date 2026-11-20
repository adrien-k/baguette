/**
 * The model a Slack assistant starts with when its owner has no default: Haiku, else Composer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const resolver = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../agent-mcp-model-resolver.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveMcpBuilderModel: resolver.resolve,
}));

const configs = vi.hoisted(() => ({ models: {} }));
vi.mock('../feathers/agent-configs.service.js', () => ({
  listModelsForOwnedConfig: vi.fn(async (_app, { configId }) => {
    const models = configs.models[configId];
    if (models instanceof Error) throw models;
    return { models };
  }),
}));

import { BadRequest } from 'feathers/errors';
import { MCP_BUILDER_MODEL_SETTINGS_ERROR } from '../agent-mcp-model-resolver.js';
import { createAssistantModelResolver, pickFallbackModel } from '../slack-assistant-model.js';
import { insertUser } from './slack-test-helpers.js';

const db = createTestDb();

const model = (id, display_name = id) => ({ id, display_name });
const candidate = (m, configId = 1) => ({ config: { id: configId, sdk: 'claude' }, model: m });

describe('pickFallbackModel', () => {
  it('prefers Haiku over Composer', () => {
    const pick = pickFallbackModel([
      candidate(model('composer-2')),
      candidate(model('claude-haiku-4-5')),
    ]);
    expect(pick.model.id).toBe('claude-haiku-4-5');
  });

  it('takes Composer when there is no Haiku', () => {
    const pick = pickFallbackModel([candidate(model('sonnet')), candidate(model('composer-2'))]);
    expect(pick.model.id).toBe('composer-2');
  });

  it('takes the newest version of the family', () => {
    const pick = pickFallbackModel([
      candidate(model('claude-haiku-3-5')),
      candidate(model('claude-haiku-4-5')),
      candidate(model('claude-haiku-4')),
    ]);
    expect(pick.model.id).toBe('claude-haiku-4-5');
  });

  it('matches on the display name too', () => {
    expect(pickFallbackModel([candidate(model('m1', 'Composer 2.5'))]).model.id).toBe('m1');
  });

  it('is null when no candidate belongs to a fallback family', () => {
    expect(pickFallbackModel([candidate(model('sonnet')), candidate(model('opus'))])).toBeNull();
    expect(pickFallbackModel([])).toBeNull();
  });
});

describe('createAssistantModelResolver', () => {
  const app = { get: () => db };
  const configRow = (userId, fields = {}) =>
    db('agent_configs')
      .insert({ user_id: userId, label: 'cfg', sdk: 'claude', ...fields })
      .then(([id]) => id);

  beforeEach(() => {
    resolver.resolve.mockReset();
    configs.models = {};
  });

  it('keeps the owner’s default model when there is one', async () => {
    const userId = await insertUser(db);
    const chosen = { agent_config_id: 9, agent_sdk: 'claude', model: 'opus', model_params: null };
    resolver.resolve.mockResolvedValue(chosen);
    expect(await createAssistantModelResolver(app)(db, userId, {})).toBe(chosen);
  });

  it('falls back to Haiku when no default model is set', async () => {
    const userId = await insertUser(db);
    const configId = await configRow(userId);
    configs.models[configId] = [model('claude-sonnet-4'), model('claude-haiku-4-5')];
    resolver.resolve.mockRejectedValue(new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR));

    expect(await createAssistantModelResolver(app)(db, userId, {})).toEqual({
      agent_config_id: configId,
      agent_sdk: 'claude',
      model: 'claude-haiku-4-5',
      model_params: null,
    });
  });

  it('looks across the owner’s configurations and skips one that cannot list models', async () => {
    const userId = await insertUser(db);
    const broken = await configRow(userId, { label: 'broken' });
    const cursor = await configRow(userId, { label: 'cursor', sdk: 'cursor' });
    configs.models[broken] = new Error('invalid api key');
    configs.models[cursor] = [model('composer-2')];
    resolver.resolve.mockRejectedValue(new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR));

    expect(await createAssistantModelResolver(app)(db, userId, {})).toMatchObject({
      agent_config_id: cursor,
      agent_sdk: 'cursor',
      model: 'composer-2',
    });
  });

  it('ignores other people’s and deleted configurations', async () => {
    const userId = await insertUser(db);
    const other = await insertUser(db);
    const theirs = await configRow(other);
    const deleted = await configRow(userId, { deleted_at: new Date().toISOString() });
    configs.models[theirs] = [model('claude-haiku-4-5')];
    configs.models[deleted] = [model('claude-haiku-4-5')];
    resolver.resolve.mockRejectedValue(new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR));

    await expect(createAssistantModelResolver(app)(db, userId, {})).rejects.toThrow(
      /Haiku or Composer/
    );
  });

  it('explains what to do when nothing can be used', async () => {
    const userId = await insertUser(db);
    const configId = await configRow(userId);
    configs.models[configId] = [model('claude-sonnet-4')];
    resolver.resolve.mockRejectedValue(new BadRequest(MCP_BUILDER_MODEL_SETTINGS_ERROR));

    await expect(createAssistantModelResolver(app)(db, userId, {})).rejects.toThrow(
      'Settings → Agent'
    );
  });

  it('does not hide other errors', async () => {
    const userId = await insertUser(db);
    resolver.resolve.mockRejectedValue(new BadRequest('Unknown preset'));
    await expect(createAssistantModelResolver(app)(db, userId, {})).rejects.toThrow(
      'Unknown preset'
    );
  });
});
