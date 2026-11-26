// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseMessageRow } from '@baguette/shared/parse-message-row.ts';

const createDefaultBuilderMessage = vi.fn(() => Promise.resolve({}));
const toastError = vi.fn();

vi.mock('../../../feathers.js', () => ({
  sessionsService: { createDefaultBuilderMessage },
}));

vi.mock('../../../utils/toastError.jsx', () => ({
  toastError,
}));

const AutoPushFailedNotice = (await import('../AutoPushFailedNotice.tsx')).default;

describe('AutoPushFailedNotice', () => {
  beforeEach(() => {
    createDefaultBuilderMessage.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders failure details and posts a message to the chat when clicked', async () => {
    render(
      createElement(AutoPushFailedNotice, {
        error: 'non-fast-forward updates were rejected',
        conflict: false,
        sessionId: 42,
        agentId: 7,
      })
    );

    expect(screen.getByText('Auto-push failed')).toBeTruthy();
    expect(screen.getByText('non-fast-forward updates were rejected')).toBeTruthy();
    expect(screen.getByText('Ask the agent to resolve the issue and push again.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ask agent to fix & push' }));

    await waitFor(() => {
      expect(createDefaultBuilderMessage).toHaveBeenCalledWith({
        id: 42,
        agent_id: 7,
        content:
          'Auto-push failed (non-fast-forward updates were rejected). Please fix the issue and push the changes again.',
      });
    });
  });

  it('renders conflict heading when conflict is true', () => {
    render(
      createElement(AutoPushFailedNotice, {
        error: 'Push failed due to a conflict',
        conflict: true,
        sessionId: 42,
      })
    );

    expect(screen.getByText('Auto-push failed due to a conflict')).toBeTruthy();
  });

  it('hides the action button when userReplied or readonly is true', () => {
    const { rerender } = render(
      createElement(AutoPushFailedNotice, {
        error: 'Push failed',
        sessionId: 42,
        userReplied: true,
      })
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      createElement(AutoPushFailedNotice, {
        error: 'Push failed',
        sessionId: 42,
        readonly: true,
      })
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('parses auto_push_failed fields through parseMessageRow', () => {
    const parsed = parseMessageRow({
      id: 10,
      session_id: 42,
      type: 'system',
      subtype: 'status',
      created_at: '2026-11-26T11:00:00.000Z',
      turn_id: null,
      tool_call_id: null,
      tool_status: null,
      tool_started_at: null,
      tool_ended_at: null,
      total_cost_usd: null,
      message_json: JSON.stringify({
        type: 'system',
        subtype: 'status',
        status: 'Auto-push failed: Push failed due to a conflict',
        auto_push_failed: true,
        auto_push_error: 'Push failed due to a conflict',
        auto_push_conflict: true,
      }),
    });

    expect(parsed.type).toBe('system');
    if (parsed.type === 'system') {
      expect(parsed.auto_push_failed).toBe(true);
      expect(parsed.auto_push_error).toBe('Push failed due to a conflict');
      expect(parsed.auto_push_conflict).toBe(true);
    }
  });
});
