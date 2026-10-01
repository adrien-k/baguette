import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { encrypt } from '../../lib/encrypt.js';

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue([{ id: 'sonnet', display_name: 'Sonnet' }]),
}));
const listCursorModels = vi.fn().mockResolvedValue([]);
vi.mock('../cursor-models.js', () => ({
  listCursorModels: (...args) => listCursorModels(...args),
}));

import { buildBaguetteAccountToolList } from '../baguette-account-mcp-tools.js';

const db = createTestDb({ beforeEach, afterEach });

describe('CreateSession MCP agent defaults', () => {
  let app;
  let user;
  let createSpy;

  beforeEach(async () => {
    listCursorModels.mockResolvedValue([]);
    await db('users').insert({
      github_id: 99,
      username: 'mcp-user',
      approved: true,
      anthropic_api_key_encrypted: encrypt('sk-ant-test'),
      agent_defaults: JSON.stringify({
        agent_sdk: 'claude',
        model: 'sonnet',
        model_params: null,
      }),
    });
    user = await db('users').where({ username: 'mcp-user' }).first();

    createSpy = vi.fn().mockResolvedValue({ id: 42, short_id: 'abc12345' });
    app = {
      get: () => db,
      service: (name) => {
        if (name === 'users') {
          return {
            get: async (id) => {
              const row = await db('users').where({ id }).first();
              return {
                ...row,
                anthropic_api_key: 'sk-ant-test',
                cursor_api_key: null,
                agent_defaults: row.agent_defaults,
              };
            },
          };
        }
        if (name === 'repos') {
          return {
            find: async () => ({
              data: [
                {
                  id: 1,
                  full_name: 'acme/repo',
                  default_branch: 'main',
                  anthropic_api_key: null,
                  cursor_api_key: 'cursor-test',
                },
              ],
            }),
          };
        }
        if (name === 'sessions') {
          return { create: createSpy };
        }
        throw new Error(`unexpected service ${name}`);
      },
    };

    await db('repos').insert({
      id: 1,
      full_name: 'acme/repo',
      stripped_name: 'acme-repo',
      bare_path: '/tmp/acme-repo.git',
      default_branch: 'main',
    });
    await db('user_repos').insert({ user_id: user.id, repo_id: 1 });
  });

  it('uses last session when defaults are in last-used mode', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        agent_defaults: JSON.stringify({ agent_sdk: null, model: null, model_params: null }),
      });
    await db('sessions').insert({
      user_id: user.id,
      repo_full_name: 'acme/repo',
      base_branch: 'main',
      initial_prompt: 'prior',
      agent_sdk: 'claude',
      model: 'sonnet',
    });

    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_sdk: 'claude', model: 'sonnet' }),
      expect.any(Object)
    );
  });

  it('applies stored defaults when agent_sdk and model are omitted', async () => {
    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_sdk: 'claude', model: 'sonnet' }),
      expect.any(Object)
    );
  });

  it('applies stored cursor model_params when omitted', async () => {
    await db('users')
      .where({ id: user.id })
      .update({
        agent_defaults: JSON.stringify({
          agent_sdk: 'cursor',
          model: 'composer',
          model_params: [{ id: 'fast', value: 'true' }],
        }),
        cursor_api_key_encrypted: encrypt('cursor-test'),
      });

    listCursorModels.mockResolvedValue([
      {
        id: 'composer',
        display_name: 'Composer',
        variants: [{ params: [{ id: 'fast', value: 'true' }], is_default: true }],
      },
    ]);

    const cursorApp = {
      ...app,
      service: (name) => {
        if (name === 'users') {
          return {
            get: async (id) => {
              const row = await db('users').where({ id }).first();
              return {
                ...row,
                anthropic_api_key: 'sk-ant-test',
                cursor_api_key: 'cursor-test',
                agent_defaults: row.agent_defaults,
              };
            },
          };
        }
        return app.service(name);
      },
    };

    const tools = buildBaguetteAccountToolList({ id: user.id }, cursorApp);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_sdk: 'cursor',
        model: 'composer',
        model_params: JSON.stringify([{ id: 'fast', value: 'true' }]),
      }),
      expect.any(Object)
    );
  });

  it('keeps explicit agent_sdk and model', async () => {
    const tools = buildBaguetteAccountToolList({ id: user.id }, app);
    const createSession = tools.find((t) => t.name === 'CreateSession');
    await createSession.handler({
      repo_id: 1,
      base_branch: 'main',
      initial_prompt: 'hello',
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent_sdk: 'claude', model: 'sonnet' }),
      expect.any(Object)
    );
  });
});
