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

export function createAskUserQuestionsTool() {
  return {
    name: 'AskUserQuestions',
    description:
      'Present questions to the user inline in chat. Use when you need confirmation, a choice, or follow-up answers. End your turn right after this tool returns—no extra assistant message. Do not ask the same questions in prose.',
    schema: {
      questions: z.array(questionSchema).min(1).describe('Questions to show'),
    },
    handler: async ({ questions }) => ok({ questions }),
  };
}
