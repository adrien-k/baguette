/** Switching a Slack thread to another session: request detection, matching and the picker UI. */

export const SWITCH_ACTION_PREFIX = 'switch_session';
const MAX_BUTTONS = 5;
const MAX_LABEL = 75;

const SWITCH_PATTERNS = [
  // "switch to the login session", "go back to session 12", "continue in my checkout session"
  /\b(?:switch|go|move|jump|continue|resume)\s+(?:back\s+)?(?:over\s+)?(?:to|in|into)\s+(?:\S+\s+){0,4}?sessions?\b/i,
  // "switch session", "resume session 12"
  /\b(?:switch|resume)\s+(?:\S+\s+){0,4}?sessions?\b/i,
];

const STOP_WORDS = new Set(
  'switch go move jump continue resume to in into the a an my this that other another session sessions please can could you would baguette back over thread on and then use'.split(
    ' '
  )
);

/** "switch to the login session" → { tokens: ['login'] }; null when it is not a switch request. */
export function parseSwitchRequest(text) {
  const value = String(text ?? '');
  if (!SWITCH_PATTERNS.some((pattern) => pattern.test(value))) return null;
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !STOP_WORDS.has(token));
  return { tokens };
}

/** Sessions matching the words (id, title, repo, branch, prompt), best first; others dropped. */
export function rankSessions(sessions, tokens) {
  return sessions
    .map((session) => {
      const fields = {
        label: String(session.label ?? '').toLowerCase(),
        repo: String(session.repo_full_name ?? '').toLowerCase(),
        branch: `${session.remote_branch ?? ''} ${session.local_branch ?? ''}`.toLowerCase(),
        prompt: String(session.initial_prompt ?? '')
          .slice(0, 300)
          .toLowerCase(),
      };
      let score = 0;
      for (const token of tokens) {
        if (String(session.id) === token) score += 10;
        if (fields.label.includes(token)) score += 3;
        if (fields.repo.includes(token)) score += 2;
        if (fields.branch.includes(token)) score += 2;
        if (fields.prompt.includes(token)) score += 1;
      }
      return { session, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.session);
}

const truncate = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** "#12 · Fix login test · repo" — as shown on a picker button or option. */
export function sessionPickerLabel(session) {
  const title =
    session.label?.trim() ||
    String(session.initial_prompt ?? '')
      .split('\n')[0]
      .trim() ||
    'Untitled';
  const repo = String(session.repo_full_name ?? '')
    .split('/')
    .pop();
  return truncate(`#${session.id} · ${title}${repo ? ` · ${repo}` : ''}`, MAX_LABEL);
}

/** Up to 5 sessions become buttons; more become a select menu. */
export function buildSessionPickerBlocks(intro, sessions) {
  const plain = (text) => ({ type: 'plain_text', text, emoji: true });
  const elements =
    sessions.length <= MAX_BUTTONS
      ? sessions.map((session) => ({
          type: 'button',
          action_id: `${SWITCH_ACTION_PREFIX}_${session.id}`,
          text: plain(sessionPickerLabel(session)),
          value: String(session.id),
        }))
      : [
          {
            type: 'static_select',
            action_id: SWITCH_ACTION_PREFIX,
            placeholder: plain('Choose a session'),
            options: sessions.map((session) => ({
              text: plain(sessionPickerLabel(session)),
              value: String(session.id),
            })),
          },
        ];
  return [
    { type: 'section', text: { type: 'mrkdwn', text: intro } },
    { type: 'actions', block_id: 'baguette_switch_session', elements },
  ];
}

export const ARCHIVE_OLD_ACTION_PREFIX = 'archive_old_session';
export const KEEP_OLD_ACTION_PREFIX = 'keep_old_session';

/** "archive_old_session_12" → { archive: true, sessionId: 12 }; null for any other action id. */
export function parseOldSessionAction(actionId) {
  const match = /^(archive|keep)_old_session_(\d+)$/.exec(String(actionId ?? ''));
  return match ? { archive: match[1] === 'archive', sessionId: Number(match[2]) } : null;
}

export const oldSessionQuestion = (session) =>
  `What should happen to the previous session, ${sessionPickerLabel(session)}? ` +
  "It won't post in this thread any more either way.";

/** After a switch: archive the session this thread just left, or leave it abandoned. */
export function buildOldSessionBlocks(session) {
  const plain = (text) => ({ type: 'plain_text', text, emoji: true });
  return [
    { type: 'section', text: { type: 'mrkdwn', text: oldSessionQuestion(session) } },
    {
      type: 'actions',
      block_id: 'baguette_old_session',
      elements: [
        {
          type: 'button',
          action_id: `${ARCHIVE_OLD_ACTION_PREFIX}_${session.id}`,
          text: plain('Archive it'),
        },
        {
          type: 'button',
          action_id: `${KEEP_OLD_ACTION_PREFIX}_${session.id}`,
          text: plain('Keep it'),
        },
      ],
    },
  ];
}
