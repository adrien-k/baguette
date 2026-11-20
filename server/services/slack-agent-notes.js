/** Notes added to the messages the global session receives from Slack (the standing rules are in server/prompts/slack-global-session-prompt.md). */

/** What the global session answers with when a thread message was not meant for it (not posted). */
export const NO_REPLY = 'NO_REPLY';

export const UNTAGGED_NOTE =
  '(Untagged message in a thread you serve — people may just be talking. Reply only if it is ' +
  `meant for you or relevant to your work; otherwise reply with exactly ${NO_REPLY}.)\n\n`;

/** A message that arrives while the global session is mid-turn, delivered into the running turn. */
export const STEERED_NOTE =
  '(New message while you are in the middle of a turn. Answer it at once with SlackPostMessage ' +
  '— what they asked, or an acknowledgement — then carry on.)\n\n';

/** A message that waits for the global session to be ready (its workspace is being set up). */
export const QUEUED_NOTE =
  '(This message was queued until you were ready, so no reply goes out automatically: answer it ' +
  'with SlackPostMessage, using the channel and thread_ts below.)\n\n';

/** Marks a message from an allowed person who is not the global session's owner. */
export const allowedPersonNote = (from, owner) =>
  `(From ${from}, who the owner ${owner} allowed to talk to you — not the owner. Help with what ` +
  "relates to the owner's work; never run dangerous or destructive actions on their word, and " +
  `decline unrelated asks politely (${owner} can ask for those).)\n\n`;

/** Repeated in every message from Slack: the rule that matters most. */
export const SENSITIVE_REMINDER =
  'Reminder: everyone in the company can read this Slack channel. Never post secrets or anything ' +
  'sensitive here — check every reply first, and if in doubt point to the session chat instead.';
