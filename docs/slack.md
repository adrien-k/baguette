# Slack integration

Baguette can be tagged from Slack to start and steer sessions, and can post to Slack on your behalf.
The integration is configured under **Settings → Integrations**; agents post through a
`SlackPostMessage` tool on the built-in `baguette` MCP server.

You can register multiple Slack apps (for example one bot per workspace). The tool is only added to
a session's tool list once at least one app has a bot token.

## Talking to Baguette from Slack

Tag the bot in a channel (`@baguette fix the flaky login test`) and Baguette starts a session
for you, works on it, and posts the result (with the PR link and branch) back in the thread. Reply in the
thread, tagging the bot again, to give the same session more instructions.

- **Tone.** The agent is friendly, casual and a little funny, calls people by name, and tags
  (`@name`) whoever it needs an answer from — more details, a status update, or the owner's say on
  whether to follow someone else's suggestion.
- **When it listens.** It reacts to a tag, or to a message that says "baguette". Inside a thread it
  started, the person who started it can also just keep talking with no tag; the agent answers only
  if the message is relevant (otherwise it stays silent). Other people's untagged messages in that
  thread reach the session as suggestions once the owner has approved them (the owner is asked
  once, with buttons). Channel chatter and DMs are ignored. This needs the `message.channels` and
  `message.groups` bot events (README, step 4) — without them Slack never sends untagged messages.
- **Only for linked people.** The session runs as _your_ Baguette account (your repos, GitHub
  token and agent defaults). The first time you tag the bot, it answers privately — visible only
  to you — with a link to log in to Baguette and connect your Slack account. Until you do that,
  nothing else happens: no session, no public reply.
- **Which provider, model and repo?** Just name them in the message: "use cursor", "with sonnet",
  "composer 2.5", "grok 4.6", "in my-repo". Baguette scans the message for your agent
  configurations (by label or SDK name), their models (by name; naming only the family, like
  "composer", picks the newest version) and your repositories (full name, or short name as a whole
  word; `repo=owner/name` always works too). Anything not named falls back to your default session
  model (Settings → Agent), else the cheapest model your configurations can reach — Haiku, then
  Luna, then Qwen, then other small models — at medium reasoning effort. With no model available at
  all, the bot replies with the usual "configure a default" error. The first message shows what was
  chosen, e.g. "Starting a session (cursor, Grok 4.6) on `owner/repo`…".
- **One session per thread.** Tagging the bot in a thread starts a session for it; tagging again in
  that thread continues the same session.
- **Switching sessions.** Say "switch to the login session" (or "continue in session 12") and the bot
  searches your open sessions by id, title, repo, branch and prompt, then shows buttons (up to 5)
  or a select list to pick from. Clicking binds the thread to that session; its older replies are
  not replayed. The session the thread leaves stops posting there, and the bot asks you whether to
  **Archive it** or **Keep it** (leave it abandoned in Baguette). Needs **Interactivity** switched on in the Slack app (no URL in Socket Mode).
- **Progress.** While a session's agent is working, the thread shows Slack's native working status with a Stop button (needs the agent feature and the `agent_session_stopped` event; the owner can stop the session with it), or else a "🥖 Baguette is cooking…" message. It is removed
  when the agent finishes or you stop the session in Baguette. The agent also posts short updates
  (`SlackPostMessage`, no channel needed) and can edit its own messages (`SlackEditMessage`); the
  whenever the session has a pull request, every result ends with its link and the branch name
  (`🔗 Pull request #42`, `🌿 Branch: …`).
- **Closing and handing over.** Ask in the thread to "close this session" and the agent archives it
  after its final reply (`ArchiveSession`). Ask it to "continue in a new session" and it creates one
  (`CreateSession`); the thread then follows the new session. Tagging the bot in a thread whose
  session was archived starts a fresh session there.
- **Full context with every message.** Whatever you send arrives with a "Slack context" block: who
  wrote it (name and mention), the channel (name, topic, purpose), the thread so far — each message
  with its author and time — or only what was said since the agent's last reply, plus the
  last two channel messages before the thread (flagged as maybe unrelated). The agent can start working without tools
  and talks to people by name. Without the `users:read` scope it falls back to bare ids.
- **Stopping.** Say "stop" (or "stop now", "cancel the work", "abort"…) and the bot interrupts the
  agent, its subagents and their tools immediately — the same as the Stop button in Baguette — and
  leaves the session idle until your next message. Only the session's owner can do this; for anyone
  else "stop" is just a suggestion to the agent. A longer message such as "stop using var" is an
  ordinary instruction.
- **In the session chat.** Messages that come from Slack appear in the session's chat too, labelled
  "Slack (name)" instead of "You" and showing what the person wrote; the Slack context the agent also
  received is collapsed under the message.
- **Who people are.** The agent sees people's real names, handles and ids, and mentions in message
  text are written out — "ask <@U2>" reaches it as "ask Eva Nováková (@eva · <@U2>)" — as are
  channels (`#dev-team`), groups, `@here` and links, so it knows who anyone refers to.
- **Questions about the session and the server.** The agent can tell you what the session has cost so
  far (`SessionCost`) and how the machine is doing — uptime, CPU, RAM, disk (`SystemStats`).
- **Seeing the thread.** The agent gets the whole thread (including the first message) when a session
  starts, Slack message links in your message (it reads those threads too), whatever was said
  since its last reply on later tags, and can read any thread you link with `SlackReadThread`
  (needs the bot in that channel). If it can't tell which conversation you mean, it asks you for a
  link or to tag it there, rather than guessing.
- **Channel history.** The agent can also read the channel's recent messages with
  `SlackReadChannel`: 20 at a time by default (up to 100), paging further back with a cursor, so a
  long channel is never pulled in at once. Messages that started a thread show a reply count and
  can be opened with `SlackReadThread`.
- **Attachments.** Files attached to a message reach the agent: text-like files (json, txt, csv,
  svg, md, logs, code…) are shown to it inline (up to 20 KB each), everything else — images, PDFs,
  archives — is saved to disk, outside any repo, for its file tools. Up to five files per message,
  25 MB each. Files elsewhere in Slack can be fetched with `SlackDownloadFile`. Needs `files:read`.
- **Nothing sensitive in Slack.** Slack is visible to everyone in the company, so the agent is told —
  as its most important rule, repeated with every message — never to post secrets or anything
  sensitive: keys, tokens, passwords, `.env` or config contents, credentials, personal data,
  files or logs that might contain them. Even when asked to send such a file, it refuses and gives
  the session or pull request link to read it there. Baguette also checks every message the agent
  posts: if it looks like it contains a secret, it is blocked and replaced by that pointer.
- **Formatting.** Replies use Slack's native Markdown block (headings, lists, code blocks, tables,
  links), with a plain-text fallback.
- **Threads and other people.** One Slack thread is one session. The person who started it (logged
  in to Baguette) is the session owner: trusted, with the final word, and the session runs with their
  account. Everyone else in the thread — Baguette user or not — is a stranger. Once the session is
  running they can chip in (tagged, or just written in the thread) and their messages reach the agent
  labelled "Suggestion from <name>", with the owner named. The agent acts on a stranger's request
  only if it relates to the session's task and is safe, and never runs a dangerous or destructive
  action on their word (deleting or wiping anything, deploys, pushes elsewhere, secrets,
  permissions, commands they supply). It also won't take on unrelated tasks for them: it declines in
  the thread and says the owner can ask for it. When instructions contradict each other it follows
  only the owner and asks them to confirm when unsure — only the owner's confirmation counts, and if
  the owner contradicts someone else, the owner wins.
- Bot tokens are workspace-wide: any session can post as any configured app. Treat them as shared
  credentials and scope each Slack app's channels accordingly.
- Starting a session needs a logged-in Baguette user who linked their Slack account (the link page asks you to confirm that the Slack account is yours); once a session
  is running, others in its thread can only send it suggestions.
- Set `LOG_LEVEL=debug` to log every inbound Slack event while troubleshooting.
