import { isTurnStartingUserMessage } from '@baguette/shared/turn-model.js';
import { isPrimaryAgent } from '../../utils/sessionAgents.js';

/**
 * Show session `initial_prompt` in chat until the server persists the first
 * turn-starting user message (after worktree provisioning).
 */
export function shouldShowPendingInitialPrompt({ session, messages, activeAgent }) {
  const prompt = session?.initial_prompt?.trim();
  if (!prompt) return false;
  if (activeAgent && !isPrimaryAgent(activeAgent)) return false;
  if (messages.some((m) => isTurnStartingUserMessage(m))) return false;
  return true;
}
