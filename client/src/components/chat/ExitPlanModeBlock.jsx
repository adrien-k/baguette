import { planMarkdownFromToolInput } from '@baguette/shared/session-message-mappers.js';
import PlanReviewBlock from './PlanReviewBlock.jsx';

/** Legacy tool_call rows for ExitPlanMode before plan message type existed. */
export default function ExitPlanModeBlock({ block, sessionId, userReplied = false }) {
  const markdown = planMarkdownFromToolInput(block.input);
  return <PlanReviewBlock markdown={markdown} sessionId={sessionId} userReplied={userReplied} />;
}
