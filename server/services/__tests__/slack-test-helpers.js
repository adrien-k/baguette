/**
 * Fixtures for the Slack tests, on the real migrated schema (see test-utils/db.js).
 */
import { feathers } from '@feathersjs/feathers';
import { encrypt } from '../../lib/encrypt.js';
import { registerSlackService } from '../feathers/slack.service.js';
import { registerSlackThreadsService } from '../feathers/slack-threads.service.js';
import { insertTestSession } from '../../test-utils/db.js';

let counter = 0;
const next = () => (counter += 1);

export async function insertUser(db, overrides = {}) {
  const n = next();
  const [id] = await db('users').insert({
    github_id: 1000 + n,
    username: `user${n}`,
    approved: true,
    ...overrides,
  });
  return id;
}

export async function insertRepo(db, userId, fullName, { defaultBranch = 'main' } = {}) {
  const [repoId] = await db('repos').insert({
    full_name: fullName,
    repo_path: `/tmp/${fullName}`,
    default_branch: defaultBranch,
  });
  await db('user_repos').insert({ user_id: userId, repo_id: repoId });
  return repoId;
}

export async function insertSlackApp(db, overrides = {}) {
  const [id] = await db('slack_apps').insert({
    name: `app${next()}`,
    bot_token_encrypted: encrypt('xoxb-test'),
    app_token_encrypted: encrypt('xapp-test'),
    signing_secret_encrypted: encrypt('signing-secret'),
    api_app_id: 'A1',
    bot_user_id: 'UBOT',
    ...overrides,
  });
  return id;
}

export const linkSlackUser = (db, slackAppId, slackUserId, userId) =>
  db('slack_user_links').insert({
    slack_app_id: slackAppId,
    slack_user_id: slackUserId,
    user_id: userId,
  });

/** A session with its builder agent; pass `status: 'running'` for a working agent. */
export function insertSession(db, userId, overrides = {}) {
  return insertTestSession(db, {
    user_id: userId,
    repo_full_name: 'acme/web',
    base_branch: 'main',
    initial_prompt: 'do things',
    ...overrides,
  });
}

export async function insertThread(db, fields) {
  const [id] = await db('slack_threads').insert({
    channel_id: 'C1',
    thread_ts: '9.9',
    ...fields,
  });
  return id;
}

export async function insertAssistantMessage(db, sessionId, text, { agentId } = {}) {
  const agent =
    agentId ?? (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first())?.id;
  const [id] = await db('session_messages').insert({
    session_id: sessionId,
    agent_id: agent,
    type: 'assistant',
    message_json: JSON.stringify({ type: 'assistant', blocks: [{ type: 'text', text }] }),
    agent_sdk: 'claude',
    model: 'sonnet',
  });
  return id;
}

/** App rows as the admin/slack service returns them internally (decrypted). */
export const decryptedApp = (overrides = {}) => ({
  id: 1,
  name: 'baguette',
  bot_token: 'xoxb-test',
  app_token: 'xapp-test',
  bot_user_id: 'UBOT',
  api_app_id: 'A1',
  ...overrides,
});

/** A Feathers app with the real Slack services on the test database, plus any stub services. */
export function slackTestApp(db, stubs = {}) {
  const app = feathers();
  app.set('db', db);
  registerSlackService(app);
  registerSlackThreadsService(app);
  for (const [path, service] of Object.entries(stubs)) app.use(path, service);
  return app;
}
