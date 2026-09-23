# Slack integration

Baguette can post to Slack on your behalf. The integration is configured under **Settings → Integrations**;
agents reach it through a `SlackPostMessage` tool on the built-in `baguette` MCP server.

You can register multiple Slack apps (for example one bot per workspace). The tool is only added to
a session's tool list once at least one app is saved.

## Creating a Slack app

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

Under **Settings → Integrations**, add an app:

- **Name** — how agents refer to this app (must be unique).
- **Bot user OAuth token** — the `xoxb-…` token. It is encrypted at rest with `ENCRYPTION_KEY` and
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
back to the session that posted it.

Slack API failures (missing scope, bot not in channel, revoked token, …) are returned to the agent
as tool errors with a recovery hint instead of interrupting the turn.

## Notes

- Bot tokens are workspace-wide: any session can post as any configured app. Treat them as shared
  credentials and scope each Slack app's channels accordingly.
- This integration is outbound only. Baguette does not receive Slack events or slash commands, so
  Slack cannot trigger anything in Baguette.
