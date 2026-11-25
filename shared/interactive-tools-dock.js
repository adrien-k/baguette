/**
 * Pin interactive tool_call cards above the composer (plans, questions, push approval).
 */

import { baguetteMcpShortName, baguettePlanToolIsInteractive } from './baguette-mcp-tool-names.js';
import { parseMcpJsonResult } from './parse-mcp-json-result.js';
import { findLastTurnStartIndex } from './turn-model.js';
import { hasHumanUserReplyAfter, toolCallViewId } from './tool-dock-ids.js';

function mcpToolShortName(msg) {
  if (!msg || msg.type !== 'tool_call') return '';
  if (msg.kind === 'ask_user') return 'AskUserQuestions';
  if (msg.kind !== 'mcp') return '';
  const fromArgs = msg.args?.tool ?? msg.args?.toolName;
  if (typeof fromArgs === 'string' && fromArgs) return fromArgs;
  return baguetteMcpShortName(msg.name);
}

function mcpResultData(result) {
  return parseMcpJsonResult(result);
}

function planToolIsInteractive(msg) {
  const short = mcpToolShortName(msg);
  if (short !== 'CreatePlan' && short !== 'EditPlan') return false;
  return baguettePlanToolIsInteractive(msg.args);
}

function planToolPendingUser(msg, messages, index) {
  if (!planToolIsInteractive(msg)) return false;
  if (msg.tool_status === 'error' || msg.status === 'error') return false;
  const data = mcpResultData(msg.result);
  if (data?.ok === false) return false;
  if (hasHumanUserReplyAfter(messages, index)) return false;
  return true;
}

function askUserToolPending(msg, messages, index) {
  const short = mcpToolShortName(msg);
  const isAsk =
    msg.kind === 'ask_user' || short === 'AskUserQuestions' || short === 'AskUserQuestion';
  if (!isAsk) return false;
  if (msg.tool_status === 'error' || msg.status === 'error') return false;
  if (hasHumanUserReplyAfter(messages, index)) return false;
  return true;
}

/** GitPush waiting on Push modal confirmation (persisted result). */
export function gitPushAwaitingApproval(msg) {
  if (mcpToolShortName(msg) !== 'GitPush') return false;
  const data = mcpResultData(msg.result);
  if (!data) return false;
  if (typeof data.approval_outcome === 'string' && data.approval_outcome) return false;
  return data.approval_requested === true;
}

/** Whether a tool_call may be pinned as an interactive dock item (reply checks are in the collector). */
export function isInteractiveDockToolCall(msg) {
  if (!msg || msg.type !== 'tool_call') return false;
  if (msg.tool_status === 'error' || msg.status === 'error') return false;
  if (planToolIsInteractive(msg)) {
    const data = mcpResultData(msg.result);
    if (data?.ok === false) return false;
    return true;
  }
  const short = mcpToolShortName(msg);
  if (msg.kind === 'ask_user' || short === 'AskUserQuestions' || short === 'AskUserQuestion') {
    return true;
  }
  if (gitPushAwaitingApproval(msg)) return true;
  return false;
}

/**
 * Interactive tool_call rows pinned above the composer until the user acts.
 * @param {object[]} messages
 * @returns {{ id: string; message: object; startedAt: string | null }[]}
 */
export function collectInteractiveToolsForDock(messages) {
  const out = [];
  if (!Array.isArray(messages) || messages.length === 0) return out;

  const turnStart = findLastTurnStartIndex(messages);
  let latestPlan = null;
  let latestPlanIndex = -1;
  let latestAsk = null;
  let latestAskIndex = -1;
  let latestGitPush = null;
  let latestGitPushIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'tool_call') continue;
    if (gitPushAwaitingApproval(msg)) {
      latestGitPush = msg;
      latestGitPushIndex = i;
    }
  }

  for (let i = turnStart; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'tool_call') continue;

    if (planToolPendingUser(msg, messages, i)) {
      latestPlan = msg;
      latestPlanIndex = i;
    }
    if (askUserToolPending(msg, messages, i)) {
      latestAsk = msg;
      latestAskIndex = i;
    }
  }

  const push = (msg) => {
    if (!msg) return;
    out.push({
      id: toolCallViewId(msg),
      message: msg,
      startedAt: msg.tool_started_at ?? msg.created_at ?? null,
    });
  };

  if (latestPlanIndex >= 0) push(latestPlan);
  if (latestAskIndex >= 0) push(latestAsk);
  if (latestGitPushIndex >= 0) push(latestGitPush);

  return out;
}
