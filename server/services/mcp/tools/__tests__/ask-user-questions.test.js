import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createAskUserQuestionsTool } from '../ask-user-questions.js';

function payload(result) {
  return JSON.parse(result.content[0].text);
}

describe('AskUserQuestions MCP tool', () => {
  const questions = [
    {
      question: 'Want me to implement the refactor?',
      header: 'Refactor',
      multiSelect: false,
      options: [
        { label: 'Yes', description: 'Do it' },
        { label: 'No', description: 'Skip it' },
      ],
    },
  ];

  it('keeps top-level ok:true so the tool wrapper still counts it as a success', async () => {
    const tool = createAskUserQuestionsTool();
    const result = payload(await tool.handler({ questions }));
    // baguetteMcpToolSucceeded + wrapBaguetteToolHandler rely on ok !== false to mark the agent awaiting user.
    expect(result.ok).toBe(true);
  });

  it('echoes the questions so they can be presented to the user', async () => {
    const tool = createAskUserQuestionsTool();
    const result = payload(await tool.handler({ questions }));
    expect(result.questions).toEqual(questions);
  });

  it('marks the result as unanswered and tells the model to stop instead of proceeding', async () => {
    const tool = createAskUserQuestionsTool();
    const result = payload(await tool.handler({ questions }));
    expect(result.answered).toBe(false);
    expect(result.status).toBe('awaiting_user_answer');
    expect(result.instruction).toMatch(/no user answer/i);
    expect(result.instruction).toMatch(/end your turn/i);
    expect(result.instruction).toMatch(/new message/i);
  });

  it('describes the no-answer contract in the tool description too', () => {
    const tool = createAskUserQuestionsTool();
    expect(tool.description).toMatch(/no user answer/i);
  });

  it('schema requires at least one question', () => {
    const tool = createAskUserQuestionsTool();
    const parsed = z.object(tool.schema).safeParse({ questions: [] });
    expect(parsed.success).toBe(false);
  });

  it('schema accepts a minimal question without options', () => {
    const tool = createAskUserQuestionsTool();
    const parsed = z.object(tool.schema).safeParse({ questions: [{ question: 'Proceed?' }] });
    expect(parsed.success).toBe(true);
  });
});
