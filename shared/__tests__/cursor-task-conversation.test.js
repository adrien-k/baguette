import { describe, expect, it } from 'vitest';
import {
  cursorTaskProgressFromRaw,
  parseCursorTaskConversationSteps,
} from '../cursor-task-conversation.ts';

describe('parseCursorTaskConversationSteps', () => {
  it('normalises thinking, assistant, and tool steps', () => {
    const steps = parseCursorTaskConversationSteps({
      conversationSteps: [
        { thinkingMessage: { text: 'Planning the migration.' } },
        { assistantMessage: { text: 'Starting implementation.' } },
        {
          toolCall: {
            toolCallId: 't1',
            globToolCall: {
              args: { globPattern: '**/*.js', targetDirectory: '/tmp/wt' },
              result: { success: { files: ['a.js'] } },
            },
            completedAtMs: '1',
          },
        },
      ],
    });
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ kind: 'thinking', status: 'completed' });
    expect(steps[1]).toMatchObject({ kind: 'assistant', status: 'completed' });
    expect(steps[2]).toMatchObject({
      kind: 'tool',
      tool_name: 'glob',
      status: 'completed',
    });
    expect(steps[2].label).toContain('glob');
  });

  it('unwraps Cursor success envelopes', () => {
    const { step_count, summary } = cursorTaskProgressFromRaw({
      status: 'success',
      value: {
        conversationSteps: [{ assistantMessage: { text: 'Done with agent_configs.' } }],
      },
    });
    expect(step_count).toBe(1);
    expect(summary).toBe('Done with agent_configs.');
  });
});
