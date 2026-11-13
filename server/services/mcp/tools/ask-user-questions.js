import { z } from 'zod';
import { ok } from '../lib/result.js';

const optionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

const questionSchema = z.object({
  question: z.string(),
  header: z.string().optional(),
  multiSelect: z.boolean().optional(),
  options: z.array(optionSchema).optional(),
});

/**
 * The handler returns the user's questions and waits — no answers exist in the result.
 * The model must stop here; answers arrive later as a new message ("ask_user_answer" subtype
 * from the inline answers UI) that starts the next turn. See baguette-mcp-tool-names.js:
 * AskUserQuestions is a turn-ending tool, and the wrapper marks the agent awaiting user.
 */
const AWAITING_USER_ANSWER_INSTRUCTION =
  'Your questions are now shown to the user. This result contains NO user answer yet. ' +
  'Do not proceed and do not self-select any option — no confirmation, approval, or choice has been granted. ' +
  'End your turn immediately after showing the questions, without taking any further action. ' +
  "The user's answers will arrive as a new message that starts your next turn.";

export function createAskUserQuestionsTool() {
  return {
    name: 'AskUserQuestions',
    description:
      "Present questions to the user inline in chat. Use when you need confirmation, a choice, or follow-up answers. End your turn right after this tool returns—no extra assistant message. The result text contains no user answer; the user's answers arrive later as a new message that starts your next turn. Do not ask the same questions in prose.",
    schema: {
      questions: z.array(questionSchema).min(1).describe('Questions to show'),
    },
    handler: async ({ questions }) =>
      ok({
        questions,
        status: 'awaiting_user_answer',
        answered: false,
        instruction: AWAITING_USER_ANSWER_INSTRUCTION,
      }),
  };
}
