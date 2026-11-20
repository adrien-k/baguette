# Slack integration

Baguette has a Slack assistant you can talk to from any thread — it starts and follows sessions for you — and agents can post to Slack on your behalf.
The integration is configured under **Admin → Slack**; agents post through a
`SlackPostMessage` tool on the built-in `baguette` MCP server.

You can register multiple Slack apps (for example one bot per workspace). The tool is only added to
a session's tool list once at least one app has a bot token.

## Talking to Baguette from Slack

Every Baguette user who links their Slack account gets **one Slack assistant**: a long-lived
[global session](sessions-and-agents.md) they talk to from any thread. Tag the bot
(`@baguette fix the flaky login test`) and the assistant answers right away. It never does the work
itself — it starts a session for the task (`CreateSession`), tells you so, and stays free for your
next message. When that session finishes or needs an answer, the assistant is woken up and reports
back in the thread you asked from: what happened, the pull request link, who it needs something
from. The first tag creates the assistant (a "Slack assistant" session, visible in the **Global**
list); after that every thread, in any channel, goes to the same one.

- **Who it listens to.** Only the assistant's owner — a logged-in Baguette user who linked their
  Slack account — and the people the owner allowed (session → **Details → Slack → Also listens
  to**, edited by the owner only). Everyone else is ignored: no reply, nothing reaches the
  agent. The one exception is a person without a linked Baguette account who tags the bot: they get
  a private, visible-only-to-them "log in to Baguette" link — unless the thread already belongs to
  someone's assistant, in which case they are ignored too. The assistant runs as _its owner's_
  Baguette account (repos, GitHub token, agent defaults), so allow people you trust. Messages from
  allowed people are marked as such: the assistant helps with the owner's work but never runs
  dangerous or destructive actions on their word.
- **When it listens.** To a tag, or a message that says "baguette". In a thread the assistant
  already serves, the owner and allowed people can also just keep talking without a tag; the
  assistant answers only if the message is meant for it (otherwise it stays silent). Channel
  chatter and DMs are ignored. Untagged messages need the `message.channels` and `message.groups`
  bot events (README, step 4).
- **No default model, no assistant.** The assistant and the sessions it starts use your default
  builder model (Settings → Agent). Without one the bot answers with that instruction and creates
  nothing.
- **Which repos.** The assistant picks the repository from what you wrote and asks when it is
  unclear. Under **Settings → Integrations → Slack** an app can be limited to chosen repositories;
  the assistant then only sees and starts sessions in those.
- **Tone.** Friendly, casual and a little funny, calls people by name, and tags (`@name`) whoever it
  needs an answer from.
- **Answers and progress.** The assistant's reply to a message is posted in that message's thread.
  A message that arrives while it is mid-turn gets an immediate answer. While it works, Slack's
  native working status shows under the thread (needs `assistant:write` and **Agents & AI Apps**;
  with the `agent_session_stopped` event it also has a **Stop** button that interrupts the assistant —
  owner only).
- **In the session chat.** Messages that come from Slack appear in the assistant's chat labelled
  "Slack (name)" (with "allowed person" / "not tagged" notes); the Slack context the agent also
  received is collapsed under the message.
- **Full context with every message.** Whatever you send arrives with a "Slack context" block: who
  wrote it (name and mention), the channel (name, topic, purpose), the thread (`channel` and
  `thread_ts`, so the assistant can answer there later), the thread so far — or only what was said
  since the bot's last reply — plus the last two channel messages before the thread (flagged as maybe
  unrelated). Without the `users:read` scope it falls back to bare ids.
- **Who people are.** The agent sees people's real names, handles and ids, and mentions in message
  text are written out — "ask <@U2>" reaches it as "ask Eva Nováková (@eva · <@U2>)" — as are
  channels (`#dev-team`), groups, `@here` and links.
- **Reading Slack.** `SlackReadThread` reads a whole thread (or one you link), `SlackReadChannel`
  the channel history a page at a time (20 by default, up to 100), `SlackDownloadFile` any file
  in Slack. Channels the bot can see are only readable when they could be read by the owner: ones the
  assistant already serves, public ones, or private ones the owner (by their linked Slack account)
  is a member of. These tools, `SlackEditMessage`, `SessionCost` and `SystemStats` exist only in
  Slack assistant sessions.
- **Attachments.** Files attached to a message reach the agent: text-like files (json, txt, csv,
  svg, md, logs, code…) inline (up to 20 KB each), everything else — images, PDFs, archives — saved
  to disk, outside any repo. Up to five files per message, 25 MB each. Needs `files:read`.
- **Nothing sensitive in Slack.** Slack is visible to everyone in the company, so the assistant is
  told — as its most important rule — never to post secrets or anything sensitive: keys, tokens,
  passwords, `.env` or config contents, credentials, personal data, files or logs that might contain
  them. Even when asked to send such a file, it refuses and points to the session or pull request.
  Baguette also checks every message the assistant posts: one that looks like it contains a secret
  is blocked and replaced by that pointer.
- **Formatting.** Replies use Slack's native Markdown block (headings, lists, code blocks, tables,
  links), with a plain-text fallback.
- Bot tokens are workspace-wide: any session can post as any configured app. Treat them as shared
  credentials and scope each Slack app's channels accordingly.
- Set `LOG_LEVEL=debug` to log every inbound Slack event while troubleshooting.

## Setting up the app (token-only)

1. Go to <https://api.slack.com/apps> and click **Create New App → From scratch**. Pick a name
   (e.g. `baguette`) and your workspace.
2. Open **OAuth & Permissions** and add these **Bot Token Scopes**:

   | Scope           | Needed for                         |
   | --------------- | ---------------------------------- |
   | `chat:write`    | posting messages                   |
   | `channels:read` | resolving `#channel-name` to an id |
   | `groups:read`   | the same, for private channels     |

3. Click **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`).
4. In Slack, invite the bot to every channel it should post in: `/invite @baguette`. Slack rejects
   posts to channels the bot has not joined.

## Configuring Baguette

Under **Admin → Slack**, add an app:

- **Name** — how agents refer to this app (must be unique).
- **Bot user OAuth token** — the `xoxb-…` token. It is encrypted at rest with the instance key and
  is never returned to the browser, only a mask. Save it, then hit **Test connection** to confirm
  the workspace and bot identity.

Removing an app drops it from sessions the next time they start.

## SlackPostMessage

| Argument  |                                                                                           |
| --------- | ----------------------------------------------------------------------------------------- |
| `text`    | Message text, required                                                                    |
| `channel` | Channel id (`C0123ABCD`) or name (`#eng`), required                                       |
| `app`     | Slack app name, optional when only one app is configured; required when there are several |

Returns `{ channel, ts, permalink, app }`. Channel names are resolved to ids once and memoised; an
unknown name comes back with the list of channels the bot can actually reach.

Message text uses Slack [mrkdwn](https://api.slack.com/reference/surfaces/formatting): `*bold*`,
`_italic_`, `` `code` ``, and `<https://url|label>` for links. Every message gets a footer linking
back to the session (`baguette#<id>`) with models used and total session cost when usage is recorded
(fallback: the session’s agent model).

Slack API failures (missing scope, bot not in channel, revoked token, …) are returned to the agent
as tool errors with a recovery hint instead of interrupting the turn.
