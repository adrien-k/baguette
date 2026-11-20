// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import GitPushToolBlock from '../GitPushToolBlock.tsx';
import { PushApprovalUiProvider } from '../../../context/PushApprovalUiContext.jsx';
import { createTestQueryClient } from '../../../queries/testUtils.jsx';
import { sessionKeys } from '../../../queries/keys.js';
import { sessionsService } from '../../../feathers.js';

const sessionsListeners = new Map();

vi.mock('../../../feathers.js', () => ({
  sessionsService: {
    on(event, handler) {
      if (!sessionsListeners.has(event)) sessionsListeners.set(event, new Set());
      sessionsListeners.get(event).add(handler);
    },
    off(event, handler) {
      sessionsListeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of sessionsListeners.get(event) ?? []) {
        handler(payload);
      }
    },
    get: vi.fn(),
    find: vi.fn(),
  },
  sessionIssuesService: { find: vi.fn(() => Promise.resolve({ total: 0 })) },
  tasksService: { find: vi.fn(() => Promise.resolve({ total: 0 })) },
}));

function emitSessionEvent(event, payload) {
  sessionsService.emit(event, payload);
}

/** Shape the Baguette MCP result pipeline hands to chat blocks. */
function toolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const APPROVAL_REQUEST_ID = '00000000-0000-4000-8000-000000000042';

const APPROVAL_RESULT = toolResult({
  ok: true,
  message: 'The Push approval has been opened in the UI.',
  approval_requested: true,
  request_id: APPROVAL_REQUEST_ID,
  local_branch: 'adrien-baguette/feature',
  target_branch: 'development',
  force: null,
  reason: 'fast-forward development with the finished feature work',
  auto_push_off: false,
});

function renderCard(
  props,
  { session, sessionId = 42, pushModalOpen = false, openAgentPushApproval = vi.fn() } = {}
) {
  const queryClient = createTestQueryClient();
  if (session) {
    queryClient.setQueryData(sessionKeys.detail(sessionId), session);
    queryClient.setQueryData(sessionKeys.counts(sessionId), {
      open_issues_count: 0,
      running_tasks_count: 0,
    });
  }
  return render(
    createElement(
      GitPushToolBlock,
      {
        args: { reason: 'fast-forward development' },
        sessionId,
        ...props,
      },
      null
    ),
    {
      wrapper: ({ children }) =>
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PushApprovalUiProvider, { pushModalOpen, openAgentPushApproval }, children)
        ),
    }
  );
}

function renderCardStatic(props, { sessionId = 42, session } = {}) {
  const queryClient = createTestQueryClient();
  const sessionRow = session ?? { remote_branch: 'adrien-baguette/feature', auto_push: true };
  queryClient.setQueryData(sessionKeys.detail(sessionId), sessionRow);
  queryClient.setQueryData(sessionKeys.counts(sessionId), {
    open_issues_count: 0,
    running_tasks_count: 0,
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(GitPushToolBlock, {
        args: { branch: 'development', reason: 'fast-forward development' },
        sessionId,
        ...props,
      })
    )
  );
}

describe('GitPushToolBlock', () => {
  beforeEach(() => {
    cleanup();
    sessionsListeners.clear();
  });

  it('shows push-in-progress copy during a direct push (no approval wait)', () => {
    const html = renderCardStatic({
      args: { reason: 'ship the session branch' },
      result: undefined,
    });
    expect(html).toContain('GitPush');
    expect(html).toContain('animate-spin');
    expect(html).toContain('Pushing to origin');
    expect(html).not.toContain('Waiting for the user to accept or reject');
    expect(html).toContain('ship the session branch');
  });

  it('shows approval wait copy while awaiting Push modal confirmation', () => {
    const html = renderCardStatic({ args: {}, result: APPROVAL_RESULT });
    expect(html).toContain('approval requested');
    expect(html).toContain('Waiting for the user to accept or reject');
    expect(html).toContain('Open push approval');
    expect(html).toContain('adrien-baguette/feature');
    expect(html).toContain('development');
    expect(html).toContain('fast-forward development with the finished feature work');
    expect(html).toContain('Normal push');
    expect(html).not.toContain('Auto-push is off');
    expect(html).not.toMatch(/>pushed</);
  });

  it('opens the push approval modal when the chat fallback button is clicked', async () => {
    const openAgentPushApproval = vi.fn();
    renderCard(
      { result: APPROVAL_RESULT },
      {
        session: { remote_branch: 'adrien-baguette/feature', auto_push: true },
        openAgentPushApproval,
      }
    );
    await screen.getByRole('button', { name: 'Open push approval' }).click();
    expect(openAgentPushApproval).toHaveBeenCalledTimes(1);
    expect(openAgentPushApproval.mock.calls[0][0]).toMatchObject({
      sessionId: 42,
      agentRequest: true,
      request_id: APPROVAL_REQUEST_ID,
      branch: 'development',
    });
  });

  it('hides the reopen button while the push modal is already open', () => {
    renderCard(
      { result: APPROVAL_RESULT },
      { session: { remote_branch: 'adrien-baguette/feature' }, pushModalOpen: true }
    );
    expect(screen.queryByRole('button', { name: 'Open push approval' })).toBeNull();
  });

  it('flags the requested force option', () => {
    const html = renderCardStatic({
      args: { force: 'force', reason: 'align with the rebased history' },
      result: toolResult({
        ok: true,
        approval_requested: true,
        force: 'force',
        reason: 'align with the rebased history',
      }),
    });
    expect(html).toContain('--force');
    expect(html).toContain('align with the rebased history');
  });

  it('shows branch name and pushed badge for direct push success', () => {
    const html = renderCardStatic({
      args: {},
      result: toolResult({ ok: true, branch: 'adrien-baguette/restore-gitpush' }),
    });
    expect(html).toContain('pushed');
    expect(html).toContain('adrien-baguette/restore-gitpush');
    expect(html).not.toContain('session branch');
    expect(html).not.toContain('approval requested');
  });

  it('marks a failed push as an error', () => {
    const html = renderCardStatic({
      args: {},
      result: toolResult({ ok: false, error: 'Push rejected: the remote has changes' }),
    });
    expect(html).toContain('error');
    expect(html).toContain('Push rejected: the remote has changes');
  });

  it('updates to pushed after push:complete when approval was requested', async () => {
    renderCard({
      args: { branch: 'development' },
      result: APPROVAL_RESULT,
    });
    expect(screen.getByText('approval requested')).toBeTruthy();
    emitSessionEvent('push:complete', {
      session_id: 42,
      ok: true,
      request_id: APPROVAL_REQUEST_ID,
    });
    await waitFor(() => {
      expect(screen.getByText('pushed')).toBeTruthy();
    });
    expect(screen.queryByText('approval requested')).toBeNull();
  });

  it('updates to canceled when the user dismisses the Push modal', async () => {
    renderCard({
      args: { branch: 'development' },
      result: APPROVAL_RESULT,
    });
    emitSessionEvent('push:approval-cancelled', {
      session_id: 42,
      request_id: APPROVAL_REQUEST_ID,
    });
    await waitFor(() => {
      expect(screen.getByText('canceled')).toBeTruthy();
    });
    expect(screen.queryByText('approval requested')).toBeNull();
  });

  it('after remount, persisted canceled result does not show approval wait copy', () => {
    const html = renderCardStatic({
      args: { branch: 'development', force: 'force' },
      result: toolResult({
        ok: true,
        approval_requested: false,
        approval_outcome: 'canceled',
        request_id: APPROVAL_REQUEST_ID,
        force: 'force',
        reason: 'align',
      }),
    });
    expect(html).toContain('canceled');
    expect(html).not.toContain('approval requested');
    expect(html).not.toContain('Waiting for the user to accept or reject');
  });

  it('after remount, persisted pushed result shows pushed badge', () => {
    const html = renderCardStatic({
      args: { branch: 'development' },
      result: toolResult({
        ok: true,
        approval_requested: false,
        approval_outcome: 'pushed',
        request_id: APPROVAL_REQUEST_ID,
      }),
    });
    expect(html).toContain('pushed');
    expect(html).not.toContain('approval requested');
    expect(html).not.toContain('Waiting for the user to accept or reject');
  });

  it('shows source_branch as the left-hand ref instead of session local_branch', () => {
    const html = renderCardStatic({
      args: { source_branch: 'v1.0.0', branch: 'development' },
      result: toolResult({
        ok: true,
        approval_requested: true,
        request_id: APPROVAL_REQUEST_ID,
        source_branch: 'v1.0.0',
        target_branch: 'development',
        local_branch: 'adrien-baguette/feature',
      }),
    });
    expect(html).toContain('v1.0.0');
    expect(html).toContain('development');
    expect(html).not.toContain('adrien-baguette/feature');
  });

  it('ignores push:complete for a different request id', async () => {
    renderCard({
      args: { branch: 'development' },
      result: APPROVAL_RESULT,
    });
    expect(screen.getByText('approval requested')).toBeTruthy();
    emitSessionEvent('push:complete', {
      session_id: 42,
      ok: true,
      request_id: 'other-request-id',
    });
    await waitFor(() => {
      expect(screen.getByText('approval requested')).toBeTruthy();
    });
    expect(screen.queryByText('pushed')).toBeNull();
  });
});
