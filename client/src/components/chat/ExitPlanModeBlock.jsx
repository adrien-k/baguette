import { planMarkdownFromToolInput } from '@baguette/shared/session-message-mappers.js';
import PlanReviewBlock from './PlanReviewBlock.tsx';

/** ExitPlanMode tool_use blocks (live stream) before a dedicated plan row exists. */
export default function ExitPlanModeBlock({ block, sessionId, userReplied = false }) {
  const markdown = planMarkdownFromToolInput(block.input);
  return <PlanReviewBlock markdown={markdown} sessionId={sessionId} userReplied={userReplied} />;
}
