import { createHmac } from 'node:crypto';
import { test, expect } from './fixtures.js';
import {
  devLogin,
  ensureMockE2eConfigs,
  getCurrentUser,
  patchUserSessionDefaults,
  setupAccountModelDefaults,
  slackE2eDb,
} from './helpers.js';
import {
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
} from '../shared/mock-agent-sdk.js';

/**
 * The Slack assistant against the real server, with Slack played by e2e/slack-mock.mjs: events
 * come in through the Events API (signed HTTP) or Socket Mode, answers go out through the mock's
 * Web API, and the tests read what the "workspace" received.
 */

const SLACK_URL = `http://127.0.0.1:${process.env.E2E_SLACK_PORT || 3011}`;
const SIGNING_SECRET = 'e2e-signing-secret';
const BOT = 'UBOT';
const ANSWER = MOCK_E2E_QUICK_TURN_SUMMARY;
/** A message the mock agent answers with a short, predictable turn. */
const ask = (text = '') => `${MOCK_E2E_QUICK_TURN_PROMPT} ${text}`.trim();

// Apps live as long as the server does, and a worker restart resets the counters: stay unique.
const RUN = Date.now().toString(36).toUpperCase();
let appCounter = 0;
let eventCounter = 0;
let tsCounter = 0;
/** A fresh Slack timestamp (thread ids and message ids). */
const nextTs = () => `1700${String((tsCounter += 1)).padStart(6, '0')}.000100`;

// ── The Slack mock ────────────────────────────────────────────────────────────────────────

const slackCalls = (request) => request.get(`${SLACK_URL}/__calls`).then((r) => r.json());
const clearSlackCalls = (request) => request.delete(`${SLACK_URL}/__calls`);
const mockPost = (request, path, data) => request.post(`${SLACK_URL}${path}`, { data });

/** Messages the bot posted as answers (the mock agent's reply) in a channel thread. */
const answersIn = (calls, channel, threadTs) =>
  calls.filter(
    (c) =>
      c.method === 'chat.postMessage' &&
      c.args.channel === channel &&
      c.args.thread_ts === threadTs &&
      c.args.blocks?.some((b) => b.text?.includes(ANSWER))
  );

const answerCount = async (request, channel, threadTs) =>
  answersIn(await slackCalls(request), channel, threadTs).length;

/** Waits for the bot to have answered `count` times in a thread. */
const expectAnswers = (request, channel, threadTs, count = 1) =>
  expect.poll(() => answerCount(request, channel, threadTs), { timeout: 90_000 }).toBe(count);

/** Asserts nothing is said in Slack (answers, ephemerals, placeholders) after `since` calls. */
async function expectSilence(request, since) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const said = (await slackCalls(request))
    .slice(since)
    .filter((c) => ['chat.postMessage', 'chat.postEphemeral', 'chat.update'].includes(c.method));
  expect(said).toEqual([]);
}

// ── Events ────────────────────────────────────────────────────────────────────────────────

const signed = (rawBody, { secret = SIGNING_SECRET, timestamp } = {}) => {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  return { 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': signature };
};

const eventPayload = (slackApp, event, eventId) => ({
  type: 'event_callback',
  api_app_id: slackApp.apiAppId,
  event_id: eventId ?? `EvE2E${RUN}-${(eventCounter += 1)}`,
  event,
});

/** Delivers an event the way Slack's Events API does: signed, over HTTP. */
async function sendEvent(request, slackApp, event, { eventId, headers, expectStatus } = {}) {
  const rawBody = JSON.stringify(eventPayload(slackApp, event, eventId));
  const res = await request.post('/api/slack/events', {
    headers: { 'Content-Type': 'application/json', ...(headers ?? signed(rawBody)) },
    data: rawBody,
  });
  expect(res.status()).toBe(expectStatus ?? 200);
  return res;
}

const mention = (user, channel, ts, text, extra = {}) => ({
  type: 'app_mention',
  user,
  channel,
  ts,
  text: `<@${BOT}> ${text}`,
  ...extra,
});

const threadMessage = (user, channel, threadTs, text, extra = {}) => ({
  type: 'message',
  channel_type: 'channel',
  user,
  channel,
  ts: nextTs(),
  thread_ts: threadTs,
  text,
  ...extra,
});

// ── Baguette side ─────────────────────────────────────────────────────────────────────────

/** Adds a Slack app (as the logged-in admin) that the mock's workspace "installed". */
async function createSlackApp(page, { appToken } = {}) {
  const n = (appCounter += 1);
  const name = `e2e-${RUN}-${n}`;
  const apiAppId = `AE2E${RUN}${n}`;
  const res = await page.request.post('/api/admin/slack', {
    data: {
      name,
      bot_token: `xoxb-e2e-${RUN}-${n}`,
      signing_secret: SIGNING_SECRET,
      ...(appToken ? { app_token: appToken } : {}),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = await res.json();
  withDb((db) =>
    db
      .prepare(
        `UPDATE slack_apps SET api_app_id = ?, bot_user_id = ?, team_id = 'TE2E', team_name = 'E2E Workspace' WHERE id = ?`
      )
      .run(apiAppId, BOT, id)
  );
  return { id, name, apiAppId };
}

/** Runs `work` on the e2e database and closes it. */
function withDb(work) {
  return slackE2eDb().then((db) => {
    try {
      return work(db);
    } finally {
      db.close();
    }
  });
}

const linkSlackUser = (slackApp, slackUserId, userId) =>
  withDb((db) =>
    db
      .prepare(
        `INSERT INTO slack_user_links (slack_app_id, slack_user_id, user_id) VALUES (?, ?, ?)`
      )
      .run(slackApp.id, slackUserId, userId)
  );

/** Logs in as a Baguette user; gives them the mock agent as their default model when asked. */
async function signInAs(page, username, { withModel = true } = {}) {
  await devLogin(page, username);
  if (withModel) {
    const { configA } = await ensureMockE2eConfigs(page);
    await setupAccountModelDefaults(page, configA);
  }
  return getCurrentUser(page);
}

/** The dev admin, an installed Slack app and Jan's linked Slack account. */
async function janWorld(page, options) {
  const jan = await signInAs(page, 'dev');
  const slackApp = await createSlackApp(page, options);
  await linkSlackUser(slackApp, 'UJAN', jan.id);
  return { jan, slackApp };
}

const assistantsOf = (slackApp) =>
  withDb((db) =>
    db
      .prepare('SELECT id, user_id, label, is_global FROM sessions WHERE slack_app_id = ?')
      .all(slackApp.id)
  );

/** What the agent received as user messages in a session (text, Slack context included). */
const userMessagesOf = (sessionId) =>
  withDb((db) =>
    db
      .prepare(`SELECT message_json FROM session_messages WHERE session_id = ? AND type = 'user'`)
      .all(sessionId)
      .map((row) => JSON.parse(row.message_json))
  );

const textOf = (message) =>
  typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

const soleAssistant = async (slackApp) => {
  const assistants = await assistantsOf(slackApp);
  expect(assistants).toHaveLength(1);
  return assistants[0];
};

test.beforeEach(async ({ page }) => {
  await clearSlackCalls(page.request);
});

test.describe('Slack assistant', () => {
  test.describe('the owner', () => {
    test('the first tag creates the assistant, shows it working and answers in the thread', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();

      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask('please')));
      await expectAnswers(page.request, 'C1', thread);

      const calls = await slackCalls(page.request);
      const answer = answersIn(calls, 'C1', thread)[0];
      expect(answer.args.markdown ?? answer.args.blocks[0].text).toContain(ANSWER);

      // "Setting up your assistant…" goes up first and comes down when the assistant takes over.
      const placeholder = calls.find(
        (c) => c.method === 'chat.postMessage' && c.args.text?.includes('Setting up')
      );
      expect(placeholder).toBeTruthy();
      expect(calls.some((c) => c.method === 'chat.delete' && c.args.channel === 'C1')).toBe(true);

      // The working status appears under the thread and is cleared when the turn ends.
      const statuses = calls.filter((c) => c.method === 'assistant.threads.setStatus');
      expect(statuses[0].args).toMatchObject({ channel_id: 'C1', thread_ts: thread });
      expect(statuses[0].args.status).toContain('cooking');
      await expect
        .poll(
          async () =>
            (await slackCalls(page.request)).filter(
              (c) => c.method === 'assistant.threads.setStatus' && c.args.status === ''
            ).length
        )
        .toBeGreaterThan(0);
      const agentStates = (await slackCalls(page.request))
        .filter((c) => c.method === 'agents.sessions.setStatus')
        .map((c) => c.args.status);
      expect(agentStates).toContain('processing');
      expect(agentStates.at(-1)).toBe('active');

      // A global session typed as the Slack assistant, owned by Jan.
      const assistant = await soleAssistant(slackApp);
      expect(assistant).toMatchObject({ is_global: 1, label: 'Slack assistant' });
    });

    test('keeps one assistant across threads and channels, answering where it was asked', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const places = [
        ['C1', nextTs()],
        ['C1', nextTs()],
        ['C2', nextTs()],
        ['C3', nextTs()],
      ];

      for (const [channel, thread] of places) {
        await sendEvent(page.request, slackApp, mention('UJAN', channel, thread, ask(channel)));
        await expectAnswers(page.request, channel, thread);
      }

      // Exactly one answer per place, none strayed into another thread.
      for (const [channel, thread] of places) {
        expect(await answerCount(page.request, channel, thread)).toBe(1);
      }
      const assistant = await soleAssistant(slackApp);
      expect(await userMessagesOf(assistant.id)).toHaveLength(places.length);

      // Each message told the assistant where it came from.
      const texts = (await userMessagesOf(assistant.id)).map(textOf);
      places.forEach(([channel, thread], i) => {
        expect(texts[i]).toContain(`channel ${channel}, thread_ts ${thread}`);
      });
    });

    test('keeps talking in a served thread without a tag, or by saying "baguette"', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask()));
      await expectAnswers(page.request, 'C1', thread);

      await sendEvent(page.request, slackApp, threadMessage('UJAN', 'C1', thread, ask('untagged')));
      await expectAnswers(page.request, 'C1', thread, 2);

      await sendEvent(
        page.request,
        slackApp,
        threadMessage('UJAN', 'C1', thread, `baguette, ${ask('by name')}`)
      );
      await expectAnswers(page.request, 'C1', thread, 3);

      const assistant = await soleAssistant(slackApp);
      const messages = (await userMessagesOf(assistant.id)).map(textOf);
      expect(messages[1]).toContain('Untagged message');
      expect(messages[2]).not.toContain('Untagged message');
    });

    test('starts talking in a new thread of the same channel with "baguette" at the top level', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const ts = nextTs();
      await sendEvent(page.request, slackApp, {
        type: 'message',
        channel_type: 'channel',
        user: 'UJAN',
        channel: 'C5',
        ts,
        text: `hey baguette ${ask()}`,
      });
      await expectAnswers(page.request, 'C5', ts);
    });

    test('shows the messages in the session as coming from Slack', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask('hello')));
      await expectAnswers(page.request, 'C1', thread);
      const assistant = await soleAssistant(slackApp);

      await page.goto(`/global/sessions/${assistant.id}`);
      await expect(page.getByText('Slack (jan)').first()).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      await expect(page.getByText('E2E Workspace')).toBeVisible();
    });
  });

  test.describe('what the assistant is told', () => {
    test('the thread so far, linked threads and the channel before it', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      const channel = 'C7';
      await mockPost(page.request, '/__replies', {
        channel,
        ts: thread,
        messages: [
          { ts: thread, user: 'UEVA', text: 'the checkout page is broken' },
          { ts: nextTs(), user: 'UBOB', text: 'seen it too, only on mobile' },
        ],
      });
      await mockPost(page.request, '/__replies', {
        channel: 'C9',
        ts: '1700000009.000100',
        messages: [
          { ts: '1700000009.000100', user: 'UEVA', text: 'earlier discussion about cart' },
        ],
      });
      await mockPost(page.request, '/__history', {
        channel,
        messages: [
          { ts: '1699999990.000100', user: 'UBOB', text: 'unrelated lunch plans' },
          { ts: '1699999991.000100', user: 'UEVA', text: 'did the deploy finish?' },
        ],
      });

      // Tagged inside a thread that already has a conversation.
      const tagTs = nextTs();
      await sendEvent(
        page.request,
        slackApp,
        mention(
          'UJAN',
          channel,
          tagTs,
          ask('see https://acme.slack.com/archives/C9/p1700000009000100'),
          { thread_ts: thread }
        )
      );
      await expectAnswers(page.request, channel, thread);

      const assistant = await soleAssistant(slackApp);
      const [first] = (await userMessagesOf(assistant.id)).map(textOf);
      expect(first).toContain('Message from Jan Owner');
      expect(first).toContain(`Channel: #chan-${channel}`);
      expect(first).toContain('The thread so far');
      expect(first).toContain('the checkout page is broken');
      expect(first).toContain('seen it too, only on mobile');
      expect(first).toContain('Linked Slack thread');
      expect(first).toContain('earlier discussion about cart');
      expect(first).toContain('The last 2 messages in the channel before this thread');
      expect(first).toContain('did the deploy finish?');
      // People appear with names, not bare ids.
      expect(first).toContain('Eva Friend');
    });

    test('a follow-up only carries what was said since the assistant last spoke', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      const channel = 'C8';
      await sendEvent(page.request, slackApp, mention('UJAN', channel, thread, ask()));
      await expectAnswers(page.request, channel, thread);

      await mockPost(page.request, '/__replies', {
        channel,
        ts: thread,
        messages: [
          { ts: thread, user: 'UJAN', text: 'old question' },
          { ts: nextTs(), user: BOT, text: 'old answer from the bot' },
          { ts: nextTs(), user: 'UEVA', text: 'fresh remark from Eva' },
        ],
      });
      await sendEvent(page.request, slackApp, threadMessage('UJAN', channel, thread, ask('more')));
      await expectAnswers(page.request, channel, thread, 2);

      const assistant = await soleAssistant(slackApp);
      const second = textOf((await userMessagesOf(assistant.id))[1]);
      expect(second).toContain('Other messages in the thread since your last reply');
      expect(second).toContain('fresh remark from Eva');
      expect(second).not.toContain('old question');
    });

    test('writes mentions out as names', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask('ask <@UEVA>')));
      await expectAnswers(page.request, 'C1', thread);
      const assistant = await soleAssistant(slackApp);
      expect(textOf((await userMessagesOf(assistant.id))[0])).toContain('ask Eva Friend');
    });
  });

  test.describe('other people', () => {
    test('strangers get no answer and reach nobody, tagged or not', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask()));
      await expectAnswers(page.request, 'C1', thread);
      const assistant = await soleAssistant(slackApp);
      const before = (await slackCalls(page.request)).length;

      await sendEvent(
        page.request,
        slackApp,
        mention('USTRANGER', 'C1', nextTs(), ask('delete it all'), { thread_ts: thread })
      );
      await sendEvent(
        page.request,
        slackApp,
        threadMessage('USTRANGER', 'C1', thread, ask('hello?'))
      );
      await sendEvent(
        page.request,
        slackApp,
        threadMessage('USTRANGER', 'C1', thread, `baguette ${ask('hey')}`)
      );

      await expectSilence(page.request, before);
      expect(await userMessagesOf(assistant.id)).toHaveLength(1);
      expect(await assistantsOf(slackApp)).toHaveLength(1);
    });

    test('a person without a Baguette account gets a private login link and nothing else', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();

      await sendEvent(page.request, slackApp, mention('USTRANGER', 'C1', thread, ask('hi')));

      await expect
        .poll(async () =>
          (await slackCalls(page.request)).filter((c) => c.method === 'chat.postEphemeral')
        )
        .toHaveLength(1);
      const [nudge] = (await slackCalls(page.request)).filter(
        (c) => c.method === 'chat.postEphemeral'
      );
      expect(nudge.args).toMatchObject({ channel: 'C1', user: 'USTRANGER' });
      expect(nudge.args.text).toContain('/api/slack/link?token=');
      expect(
        (await slackCalls(page.request)).filter((c) => c.method === 'chat.postMessage')
      ).toEqual([]);
      expect(await assistantsOf(slackApp)).toHaveLength(0);
    });

    test('the owner decides who else is heard — and can take it back', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      const otherThread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask()));
      await expectAnswers(page.request, 'C1', thread);
      const assistant = await soleAssistant(slackApp);

      const allow = async (usernames) => {
        await page.goto(`/global/sessions/${assistant.id}`);
        await page.getByRole('button', { name: 'Details', exact: true }).click();
        await page.getByRole('button', { name: 'Edit who the assistant listens to' }).click();
        const input = page.getByPlaceholder('usernames, comma separated');
        await input.fill(usernames);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(input).toBeHidden();
      };

      // Eva is not allowed yet.
      let mark = (await slackCalls(page.request)).length;
      await sendEvent(page.request, slackApp, threadMessage('UEVA', 'C1', thread, ask('as Eva')));
      await expectSilence(page.request, mark);

      await allow('eva');
      await expect(page.getByText('@eva')).toBeVisible();

      // Allowed: heard in the thread the assistant serves, labelled as an allowed person.
      await sendEvent(page.request, slackApp, threadMessage('UEVA', 'C1', thread, ask('as Eva')));
      await expectAnswers(page.request, 'C1', thread, 2);
      const received = (await userMessagesOf(assistant.id)).map(textOf);
      expect(received.at(-1)).toContain('allowed to talk to you');
      expect(received.at(-1)).toContain('Eva Friend');

      // …but being allowed does not let them start a conversation in a thread the assistant does
      // does not serve: nothing is said publicly, and no assistant is created for them.
      mark = (await slackCalls(page.request)).length;
      await sendEvent(
        page.request,
        slackApp,
        mention('UEVA', 'C1', otherThread, ask('in another thread'))
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const afterTag = (await slackCalls(page.request)).slice(mark);
      expect(afterTag.filter((c) => c.method === 'chat.postMessage')).toEqual([]);
      expect(await answerCount(page.request, 'C1', otherThread)).toBe(0);
      expect(await assistantsOf(slackApp)).toHaveLength(1);

      // Not allowed any more.
      await allow('');
      mark = (await slackCalls(page.request)).length;
      await sendEvent(page.request, slackApp, threadMessage('UEVA', 'C1', thread, ask('again')));
      await expectSilence(page.request, mark);
    });

    test('every owner has their own assistant, even in the same thread', async ({ page }) => {
      const { jan, slackApp } = await janWorld(page);
      const bob = await signInAs(page, 'bob');
      await linkSlackUser(slackApp, 'UBOB', bob.id);
      const thread = nextTs();

      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask('from Jan')));
      await expectAnswers(page.request, 'C1', thread, 1);
      await sendEvent(page.request, slackApp, threadMessage('UBOB', 'C1', thread, ask('hi')), {});
      // Bob did not tag the bot and does not have an assistant in this thread: ignored.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await assistantsOf(slackApp)).toHaveLength(1);

      // Tagged, Bob gets his own assistant that answers in the same thread.
      await sendEvent(
        page.request,
        slackApp,
        mention('UBOB', 'C1', nextTs(), ask('from Bob'), { thread_ts: thread })
      );
      await expectAnswers(page.request, 'C1', thread, 2);

      const assistants = await assistantsOf(slackApp);
      expect(assistants.map((a) => a.user_id).sort()).toEqual([jan.id, bob.id].sort());
      const [jans] = assistants.filter((a) => a.user_id !== bob.id);
      const [bobs] = assistants.filter((a) => a.user_id === bob.id);
      expect((await userMessagesOf(jans.id)).map(textOf).join('\n')).not.toContain('from Bob');
      expect((await userMessagesOf(bobs.id)).map(textOf).join('\n')).not.toContain('from Jan');

      // The thread now has two assistants; Jan's untagged follow-up goes only to his.
      await devLogin(page, 'dev');
      await sendEvent(
        page.request,
        slackApp,
        threadMessage('UJAN', 'C1', thread, ask('follow-up'))
      );
      await expectAnswers(page.request, 'C1', thread, 3);
      expect(await userMessagesOf(bobs.id)).toHaveLength(1);
    });
  });

  test.describe('when it cannot start', () => {
    test('with no default builder model it says what to configure and creates nothing', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const carol = await signInAs(page, 'carol', { withModel: false });
      // New users start with the mock agent as their default; take it away.
      await patchUserSessionDefaults(page, {
        agent_default_config_id: null,
        agent_default_model: null,
      });
      await linkSlackUser(slackApp, 'UCAROL', carol.id);
      const thread = nextTs();

      await sendEvent(page.request, slackApp, mention('UCAROL', 'C1', thread, ask('hi')));

      // The placeholder ("Setting up…") turns into the explanation.
      await expect
        .poll(async () =>
          (await slackCalls(page.request))
            .filter((c) => ['chat.update', 'chat.postMessage'].includes(c.method))
            .map((c) => c.args.text ?? '')
        )
        .toEqual(expect.arrayContaining([expect.stringContaining('Settings → Agent')]));
      expect(await assistantsOf(slackApp)).toHaveLength(0);
      expect(await answerCount(page.request, 'C1', thread)).toBe(0);
    });
  });

  test.describe('the Stop button', () => {
    const stopped = (user, channel, threadTs) => ({
      type: 'agent_session_stopped',
      user,
      channel,
      thread_ts: threadTs,
    });

    test('lets the owner interrupt and puts the thread back to ready', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask()));
      await expectAnswers(page.request, 'C1', thread);
      const mark = (await slackCalls(page.request)).length;

      await sendEvent(page.request, slackApp, stopped('UJAN', 'C1', thread));

      await expect
        .poll(async () =>
          (await slackCalls(page.request))
            .slice(mark)
            .some((c) => c.method === 'agents.sessions.setStatus' && c.args.status === 'active')
        )
        .toBe(true);
    });

    test('tells anyone else, privately, that only the owner can', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask()));
      await expectAnswers(page.request, 'C1', thread);
      const mark = (await slackCalls(page.request)).length;

      await sendEvent(page.request, slackApp, stopped('USTRANGER', 'C1', thread));

      await expect
        .poll(async () =>
          (await slackCalls(page.request))
            .slice(mark)
            .find((c) => c.method === 'chat.postEphemeral')
        )
        .toMatchObject({ args: { user: 'USTRANGER' } });
    });
  });

  test.describe('events that are ignored', () => {
    test('bots, edits, direct messages, chatter and repeated deliveries', async ({ page }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      await sendEvent(page.request, slackApp, mention('UJAN', 'C1', thread, ask()));
      await expectAnswers(page.request, 'C1', thread);
      const assistant = await soleAssistant(slackApp);
      const before = (await slackCalls(page.request)).length;

      const ignored = [
        mention(BOT, 'C1', nextTs(), ask('the bot itself')),
        mention('UJAN', 'C1', nextTs(), ask('a bot message'), { bot_id: 'B1' }),
        threadMessage('UJAN', 'C1', thread, ask('edited'), { subtype: 'message_changed' }),
        threadMessage('UJAN', 'C1', thread, ask('deleted'), { subtype: 'message_deleted' }),
        { ...threadMessage('UJAN', 'D1', nextTs(), `baguette ${ask('dm')}`), channel_type: 'im' },
        {
          type: 'message',
          channel_type: 'channel',
          user: 'UJAN',
          channel: 'C1',
          ts: nextTs(),
          text: ask('chatter'),
        },
        threadMessage('UJAN', 'C1', nextTs(), ask('a thread it does not serve')),
        { type: 'reaction_added', user: 'UJAN' },
      ];
      for (const event of ignored) await sendEvent(page.request, slackApp, event);
      await expectSilence(page.request, before);

      // Slack redelivers an event it thinks was lost: handled once.
      const repeated = threadMessage('UJAN', 'C1', thread, ask('once'));
      await sendEvent(page.request, slackApp, repeated, { eventId: `EvRepeat${RUN}` });
      await sendEvent(page.request, slackApp, repeated, { eventId: `EvRepeat${RUN}` });
      await expectAnswers(page.request, 'C1', thread, 2);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await answerCount(page.request, 'C1', thread)).toBe(2);
      expect(await userMessagesOf(assistant.id)).toHaveLength(2);
    });
  });

  test.describe('the Events API endpoint (public URL / tunnel)', () => {
    test('rejects bad signatures, stale requests and unknown apps — and answers Slack’s challenge', async ({
      page,
    }) => {
      const { slackApp } = await janWorld(page);
      const thread = nextTs();
      const event = mention('UJAN', 'C1', thread, ask());
      const raw = JSON.stringify(eventPayload(slackApp, event));
      const post = (headers, body = raw) =>
        page.request.post('/api/slack/events', {
          headers: { 'Content-Type': 'application/json', ...headers },
          data: body,
        });

      expect((await post(signed(raw, { secret: 'wrong-secret' }))).status()).toBe(401);
      expect((await post({})).status()).toBe(401);
      const stale = String(Math.floor(Date.now() / 1000) - 3600);
      expect((await post(signed(raw, { timestamp: stale }))).status()).toBe(401);
      const unknownApp = JSON.stringify({ ...JSON.parse(raw), api_app_id: 'ANOPE' });
      expect((await post(signed(unknownApp), unknownApp)).status()).toBe(401);
      expect(await assistantsOf(slackApp)).toHaveLength(0);

      // Slack's URL verification handshake.
      const challenge = JSON.stringify({
        type: 'url_verification',
        api_app_id: slackApp.apiAppId,
        challenge: 'abc123',
      });
      const verified = await post(signed(challenge), challenge);
      expect((await verified.json()).challenge).toBe('abc123');

      // A retry of something Slack already delivered is acknowledged but not handled again.
      const retry = await post({ ...signed(raw), 'X-Slack-Retry-Num': '1' });
      expect(retry.status()).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await assistantsOf(slackApp)).toHaveLength(0);

      // The genuine request goes through.
      expect((await post(signed(raw))).status()).toBe(200);
      await expectAnswers(page.request, 'C1', thread);
    });
  });

  test.describe('Socket Mode', () => {
    test('connects out to Slack, acknowledges envelopes and answers', async ({ page }) => {
      const appToken = `xapp-e2e-${Date.now()}`;
      const { slackApp } = await janWorld(page, { appToken });

      // The server notices the new app on its next sync and dials the mock.
      await expect
        .poll(
          async () =>
            (await page.request.get(`${SLACK_URL}/__socket`).then((r) => r.json())).connections,
          { timeout: 60_000 }
        )
        .toContain(appToken);

      const thread = nextTs();
      const envelope = {
        envelope_id: `env-${thread}`,
        accepts_response_payload: false,
        payload: eventPayload(
          { apiAppId: 'ASOCKET' },
          mention('UJAN', 'C4', thread, ask('over the socket'))
        ),
      };
      await mockPost(page.request, '/__socket/send', { app_token: appToken, envelope });

      await expectAnswers(page.request, 'C4', thread);
      const { acks } = await page.request.get(`${SLACK_URL}/__socket`).then((r) => r.json());
      expect(acks).toContain(envelope.envelope_id);
      expect(await assistantsOf(slackApp)).toHaveLength(1);
    });
  });
});
