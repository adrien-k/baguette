/** Asking a session's owner whether another Slack user may steer it: the prompt and its buttons. */

export const APPROVE_ACTION_PREFIX = 'approve_slack_user';
export const REJECT_ACTION_PREFIX = 'reject_slack_user';

/** "approve_slack_user_12_U0ABC" → { approve: true, sessionId: 12, slackUserId: 'U0ABC' }; else null. */
export function parseApprovalAction(actionId) {
  const match = /^(approve|reject)_slack_user_(\d+)_([A-Z0-9]+)$/.exec(String(actionId ?? ''));
  if (!match) return null;
  return { approve: match[1] === 'approve', sessionId: Number(match[2]), slackUserId: match[3] };
}

export function approvalPromptText({ ownerSlackId, requesterSlackId }) {
  return (
    `<@${ownerSlackId}> <@${requesterSlackId}> wrote in this thread. This session runs as you — ` +
    `should I listen to instructions from <@${requesterSlackId}>?`
  );
}

export function buildApprovalBlocks({ sessionId, ownerSlackId, requesterSlackId }) {
  const plain = (text) => ({ type: 'plain_text', text, emoji: true });
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: approvalPromptText({ ownerSlackId, requesterSlackId }) },
    },
    {
      type: 'actions',
      block_id: 'baguette_approve_user',
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: `${APPROVE_ACTION_PREFIX}_${sessionId}_${requesterSlackId}`,
          text: plain('Allow'),
        },
        {
          type: 'button',
          style: 'danger',
          action_id: `${REJECT_ACTION_PREFIX}_${sessionId}_${requesterSlackId}`,
          text: plain('Don’t allow'),
        },
      ],
    },
  ];
}
