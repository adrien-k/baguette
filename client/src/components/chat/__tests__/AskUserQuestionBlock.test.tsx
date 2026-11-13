import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AskUserQuestion } from '../AskUserQuestionBlock.tsx';

// The component only needs sessionsService on submit; mock it because the real
// module touches `window` at import time, which breaks the node test env.
vi.mock('../../../feathers.js', () => ({
  sessionsService: { createDefaultBuilderMessage: async () => ({}) },
}));

const AskUserQuestionBlock = (await import('../AskUserQuestionBlock.tsx')).default;

const validQuestions: AskUserQuestion[] = [
  {
    question: 'Which database should we use?',
    options: [{ label: 'Postgres' }, { label: 'SQLite', description: 'Embedded, zero config' }],
    multiSelect: false,
  },
];

function html(questions: unknown) {
  return renderToStaticMarkup(
    createElement(AskUserQuestionBlock, {
      questions,
      sessionId: 1,
      agentId: null,
      userReplied: false,
    })
  );
}

describe('AskUserQuestionBlock', () => {
  it('renders well-formed questions with option buttons', () => {
    const out = html(validQuestions);
    expect(out).toContain('The agent has a question');
    expect(out).toContain('Which database should we use?');
    expect(out).toContain('Postgres');
    expect(out).toContain('Embedded, zero config');
  });

  // Regression: `a.map is not a function` white-screened the session page when
  // an LLM tool call emitted a non-array `questions` payload.
  it('renders an empty form instead of crashing for non-array payloads', () => {
    expect(() => html({ questions: validQuestions })).not.toThrow();
    expect(() => html({})).not.toThrow();
    expect(() => html('not json')).not.toThrow();
    expect(() => html(42)).not.toThrow();
    expect(() => html(null)).not.toThrow();
  });

  it('unwraps a double-wrapped { questions: [...] } payload', () => {
    const out = html({ questions: validQuestions });
    expect(out).toContain('Which database should we use?');
    expect(out).toContain('Postgres');
  });

  it('wraps a single question object passed without an array', () => {
    const out = html(validQuestions[0]);
    expect(out).toContain('Which database should we use?');
  });

  it('parses JSON-string question payloads', () => {
    const out = html(JSON.stringify(validQuestions));
    expect(out).toContain('Which database should we use?');
  });

  it('drops entries without question text and junk options', () => {
    const questions = [
      { bogus: true, options: 'not an array' },
      { question: 42 },
      { header: 'Docs header' },
      { question: 'What about docs?', options: ['', { label: 3 }, { label: 'Read README' }] },
    ];
    const out = html(questions);
    expect(out).not.toContain('bogus');
    expect(out).toContain('Docs header'); // header falls back as question text
    expect(out).toContain('What about docs?');
    expect(out).toContain('Read README');
  });
});
