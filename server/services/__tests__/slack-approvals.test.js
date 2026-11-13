/**
 * Asking a session's owner whether another Slack user may steer it: action ids and prompt blocks.
 */
import { describe, expect, it } from 'vitest';
import {
  APPROVE_ACTION_PREFIX,
  REJECT_ACTION_PREFIX,
  approvalPromptText,
  buildApprovalBlocks,
  parseApprovalAction,
} from '../slack-approvals.js';

describe('parseApprovalAction', () => {
  it('reads the verb, session and Slack user from an action id', () => {
    expect(parseApprovalAction('approve_slack_user_12_U0ABC')).toEqual({
      approve: true,
      sessionId: 12,
      slackUserId: 'U0ABC',
    });
    expect(parseApprovalAction('reject_slack_user_7_W1X2')).toEqual({
      approve: false,
      sessionId: 7,
      slackUserId: 'W1X2',
    });
  });

  it.each([
    'switch_session_12',
    'approve_slack_user_12',
    'approve_slack_user_x_U1',
    'approve_slack_user_12_u1',
    'approve_slack_user_12_U1"; DROP',
    '',
    null,
    undefined,
  ])('returns null for %j', (actionId) => {
    expect(parseApprovalAction(actionId)).toBeNull();
  });
});

describe('buildApprovalBlocks', () => {
  const prompt = { sessionId: 12, ownerSlackId: 'UOWNER', requesterSlackId: 'UEVA' };

  it('mentions the owner and the requester in the question', () => {
    const text = approvalPromptText(prompt);
    expect(text).toContain('<@UOWNER>');
    expect(text).toContain('<@UEVA>');
    expect(buildApprovalBlocks(prompt)[0].text.text).toBe(text);
  });

  it('has an Allow and a Don’t allow button whose ids round-trip through the parser', () => {
    const [, actions] = buildApprovalBlocks(prompt);
    const [allow, reject] = actions.elements;
    expect(allow.action_id).toBe(`${APPROVE_ACTION_PREFIX}_12_UEVA`);
    expect(reject.action_id).toBe(`${REJECT_ACTION_PREFIX}_12_UEVA`);
    expect(parseApprovalAction(allow.action_id)).toMatchObject({ approve: true });
    expect(parseApprovalAction(reject.action_id)).toMatchObject({ approve: false });
    expect(allow.text.text).toBe('Allow');
  });
});
