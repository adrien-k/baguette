import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';

import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';

import { registerUsersService } from '../feathers/users.service.js';
import { registerReposService } from '../feathers/repos.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import {
  registerAgentConfigsService,
  registerAgentSdk,
} from '../feathers/agent-configs.service.js';
import { sessionMessageIdentity } from '../feathers/message-create-fields.js';

const db = createTestDb();

let app;
let user1;
let sessionId;

function makeApp() {
  const application = feathers();
  application.set('db', db);
  registerSessionsService(application);
  registerMessagesService(application);
  registerUsersService(application);
  registerReposService(application);
  registerAgentConfigsService(application);
  const handleMessageCreated = vi.fn(async () => {});
  application.use('claude-agent', { handleMessageCreated }, { methods: ['handleMessageCreated'] });
  registerAgentSdk(application, { key: 'claude', label: 'Claude', servicePath: 'claude-agent' });
  application._handleMessageCreated = handleMessageCreated;
  return application;
}

beforeEach(async () => {
  await db('users').insert({
    github_id: 1,
    username: 'alice',
    approved: true,
  });
  user1 = await db('users').where({ username: 'alice' }).first();
  const configId = await insertTestAgentConfig(db, user1.id, { apiKey: 'sk-ant' });
  [sessionId] = await db('sessions').insert({
    user_id: user1.id,
    repo_full_name: 'alice/repo',
    base_branch: 'main',
    initial_prompt: 'hi',
    agent_sdk: 'claude',
    agent_config_id: configId,
    status: 'stopped',
  });

  app = makeApp();
  await app.setup();
});

describe('agent-configs dispatch', () => {
  it('servicePathForSdk maps registered SDK keys', () => {
    const configs = app.service('agent-configs');
    expect(configs.servicePathForSdk('claude')).toBe('claude-agent');
  });

  it('routes created user messages to the session config SDK', async () => {
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'hello' },
        }),
        ...sessionMessageIdentity({ agent_sdk: 'claude', model: 'sonnet' }, 'builder'),
      },
      { provider: 'rest', user: user1 }
    );
    expect(app._handleMessageCreated).toHaveBeenCalled();
  });
});
