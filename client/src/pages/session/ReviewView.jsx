import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  messagesService,
  sessionIssuesService,
  sessionReviewService,
  sessionsService,
  usersService,
} from '../../feathers.js';
import { apiFetch } from '../../api.js';
import { toastError } from '../../utils/toastError.jsx';
import { isMobile } from '../../utils/isMobile.js';
import Alert from '../../components/Alert.jsx';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useGetSessionIssues } from '../../hooks/useGetSessionIssues.js';
import { useGetReviewMessages } from '../../hooks/useGetReviewMessages.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import { availableAgentSdks } from '@baguette/shared/agent-sdk-credentials.js';
import SessionModelSelect from '../../components/SessionModelSelect.jsx';
import { CHAT_COLUMN_CLASS } from '../../components/ChatMessagesViewport.jsx';
import AutoGrowTextarea from '../../components/AutoGrowTextarea.jsx';
import SessionIssueCard from '../../components/SessionIssueCard.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';

const REVIEW_FOCUS_PLACEHOLDER = 'Anything specific to focus on? (optional)';

const NEW_REVIEW_TOOLTIP =
  'Starts a new review and clears the reviewer chat history (issues are kept).';

function issueFixPrompt(issue, sessionId) {
  return (
    `Fix session review issue #${issue.id} (${issue.severity}): ${issue.title}\n\n` +
    `${issue.description || ''}\n\n` +
    `This issue is now submitted. Call ReadIssue with issue_id ${issue.id} (session_id ${sessionId}), ` +
    `or ListIssues with status "submitted". When the fix is complete, call UpdateIssueStatus with issue_id ${issue.id} and status "resolved".`
  );
}

function issuesFixAllPrompt(sessionId) {
  return (
    `Fix all submitted session review issues on this session.\n\n` +
    `Start by calling ListIssues with status "submitted" (session_id ${sessionId}). ` +
    `Implement fixes for each submitted issue, then call UpdateIssueStatus with status "resolved" for every issue you actually fixed.`
  );
}

export default function ReviewView({ session, readonly, onReviewStarted }) {
  const { user } = useAuth();
  const { repos } = useRepoContext();
  const { cursorFast, cursorEffort } = useCursorModelPrefs();
  const { issues, loading: issuesLoading } = useGetSessionIssues(session?.id);
  const { messages: reviewMessages } = useGetReviewMessages(session?.id);
  const [userSettings, setUserSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [savingIssueId, setSavingIssueId] = useState(null);
  const reviewPersist = usePersistentState(
    session?.id ? `session-review-chat-${session.id}` : undefined
  );
  const [reviewUserMessage, setReviewUserMessage] = reviewPersist.useState('focus', '');

  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === session?.repo_id),
    [repos, session?.repo_id]
  );
  const availableSdks = useMemo(
    () => (userSettings ? availableAgentSdks(userSettings, selectedRepo) : []),
    [userSettings, selectedRepo]
  );

  useEffect(() => {
    if (!user?.id) return;
    usersService
      .get(user.id)
      .then((d) => setUserSettings(d))
      .catch(() => setUserSettings({}));
  }, [user?.id]);

  const reviewAgentSdk = session?.agent_sdk || 'claude';
  const reviewModel = session?.review_model || session?.model || '';
  const reviewModelParams = session?.review_model_params ?? session?.model_params ?? null;

  useEffect(() => {
    if (!session?.id || readonly) return;
    if (session.review_model != null) return;
    if (session.model == null && session.model_params == null) return;
    sessionsService
      .patch(session.id, {
        review_agent_sdk: session.agent_sdk || 'claude',
        review_model: session.model || null,
        review_model_params: session.model_params ?? null,
      })
      .catch((err) => toastError('Failed to initialize review model', err));
  }, [
    session?.id,
    session?.review_model,
    session?.model,
    session?.model_params,
    session?.agent_sdk,
    readonly,
  ]);

  useEffect(() => {
    const url =
      reviewAgentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    apiFetch(url)
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, [reviewAgentSdk]);

  const sessionForReviewComposer = useMemo(
    () => ({
      ...session,
      agent_sdk: reviewAgentSdk,
      model: reviewModel,
      model_params: reviewModelParams,
    }),
    [session, reviewAgentSdk, reviewModel, reviewModelParams]
  );

  const opened = issues.filter((i) => i.status === 'opened');
  const isRunning = session?.review_status === 'running';
  const hasSdkKey = !userSettings || availableSdks.includes(reviewAgentSdk);
  const hasReviewConversation = reviewMessages.some(
    (m) => m.type === 'user' || m.type === 'assistant'
  );
  const showMiddleStartForm = reviewMessages.length === 0;

  const sendFixMessage = async (text) => {
    await messagesService.create({
      session_id: session.id,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    });
  };

  const handleFixIssue = async (issue) => {
    if (!session?.id || issue.status !== 'opened') return;
    try {
      await sessionIssuesService.patch(issue.id, { status: 'submitted' });
      await sendFixMessage(issueFixPrompt(issue, session.id));
    } catch (err) {
      toastError('Failed to submit issue for a fix', err);
    }
  };

  const handleFixAllOpened = async () => {
    if (!session?.id || opened.length === 0) return;
    try {
      await Promise.all(
        opened.map((issue) => sessionIssuesService.patch(issue.id, { status: 'submitted' }))
      );
      await sendFixMessage(issuesFixAllPrompt(session.id));
    } catch (err) {
      toastError('Failed to submit issues for a fix', err);
    }
  };

  const handleIssueStatus = async (issueId, status) => {
    try {
      await sessionIssuesService.patch(issueId, { status });
    } catch (err) {
      toastError('Failed to update issue status', err);
    }
  };

  const handleIssueSave = async (issueId, fields) => {
    setSavingIssueId(issueId);
    try {
      await sessionIssuesService.patch(issueId, fields);
      return true;
    } catch (err) {
      toastError('Failed to save issue', err);
      return false;
    } finally {
      setSavingIssueId(null);
    }
  };

  const handleDeleteIssue = async (issue) => {
    if (!window.confirm(`Delete issue #${issue.id} permanently?`)) return;
    try {
      await sessionIssuesService.remove(issue.id);
    } catch (err) {
      toastError('Failed to delete issue', err);
    }
  };

  const canStartReview =
    !readonly && !isRunning && !starting && hasSdkKey && Boolean(session?.worktree_path);

  const handleStart = async () => {
    if (!session?.id || starting || !canStartReview) return;
    setStarting(true);
    try {
      await sessionReviewService.start({
        session_id: session.id,
        user_message: reviewUserMessage.trim(),
      });
      onReviewStarted?.();
    } catch (err) {
      toastError('Failed to start review', err);
    } finally {
      setStarting(false);
    }
  };

  const handleReviewPromptKeyDown = (e) => {
    if (!canStartReview) return;
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStart();
    }
  };

  const handleStop = async () => {
    if (!session?.id || stopping) return;
    setStopping(true);
    try {
      await sessionReviewService.stop({ session_id: session.id });
    } catch (err) {
      toastError('Failed to stop review', err);
    } finally {
      setStopping(false);
    }
  };

  const handleReviewModelChange = async (modelId, modelParamsJson) => {
    if (!session?.id || readonly) return;
    try {
      await sessionsService.patch(session.id, {
        review_model: modelId,
        review_model_params: modelParamsJson ?? null,
      });
    } catch (err) {
      toastError('Failed to update review model', err);
    }
  };

  const reviewActionButtons = !readonly && (
    <>
      {isRunning ? (
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          className="inline-flex items-center gap-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded-lg text-sm font-medium border border-zinc-600"
        >
          {stopping ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={starting || !hasSdkKey || !session?.worktree_path}
          title={hasReviewConversation ? NEW_REVIEW_TOOLTIP : undefined}
          className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-3 py-1.5 rounded-lg text-sm font-medium"
        >
          {starting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {hasReviewConversation ? 'New review' : 'Start review'}
        </button>
      )}
      {isRunning && (
        <span className="text-xs text-amber-400 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </span>
      )}
    </>
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {showMiddleStartForm && (
        <div className="shrink-0 overflow-auto">
          <div className={`${CHAT_COLUMN_CLASS} py-4 sm:py-6`}>
            <div className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-5 sm:p-6 space-y-4">
              {userSettings && !hasSdkKey && (
                <Alert variant="alert">
                  Add a {reviewAgentSdk === 'cursor' ? 'Cursor' : 'Claude'} API key in{' '}
                  <Link to="/settings?tab=agent">Settings → Agent</Link> to run a review.
                </Alert>
              )}
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <label className="text-sm font-medium text-zinc-300">Prompt</label>
                  <Link
                    to="/settings?tab=agent&prompt=review#settings-agent-prompts"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-400 hover:text-amber-300 underline"
                  >
                    Configure the system prompt
                  </Link>
                </div>
                <div
                  className={`w-full rounded-lg border border-zinc-700 bg-zinc-800 overflow-visible ${
                    readonly || isRunning
                      ? 'opacity-60'
                      : 'focus-within:ring-2 focus-within:ring-amber-500/50'
                  }`}
                >
                  <AutoGrowTextarea
                    value={reviewUserMessage}
                    onChange={(e) => setReviewUserMessage(e.target.value)}
                    onKeyDown={handleReviewPromptKeyDown}
                    disabled={readonly || isRunning}
                    rows={1}
                    maxLines={20}
                    fitPlaceholderWhenEmpty
                    spellCheck={false}
                    placeholder={REVIEW_FOCUS_PLACEHOLDER}
                    className="block w-full bg-transparent px-3 sm:px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed resize-none leading-relaxed rounded-t-lg"
                  />
                  <div className="relative flex flex-wrap items-center gap-1 sm:gap-1.5 px-2 pb-1.5 pt-0.5 rounded-b-lg overflow-visible">
                    {hasSdkKey && (
                      <SessionModelSelect
                        session={sessionForReviewComposer}
                        models={models}
                        cursorFast={cursorFast}
                        cursorEffort={cursorEffort}
                        onModelChange={handleReviewModelChange}
                        disabled={readonly || isRunning}
                      />
                    )}
                    <div className="flex-1 min-w-0" />
                    {reviewActionButtons}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <div className={`${CHAT_COLUMN_CLASS} py-3 sm:py-4 space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            {!showMiddleStartForm && (
              <div className="flex flex-wrap items-center gap-2">{reviewActionButtons}</div>
            )}
            <div className="flex-1 min-w-0" />
            {!readonly && opened.length > 0 && (
              <button type="button" onClick={handleFixAllOpened} className={SECONDARY_BUTTON_CLASS}>
                Fix all opened ({opened.length})
              </button>
            )}
          </div>
          {issuesLoading ? (
            <p className="text-xs text-zinc-500">Loading issues…</p>
          ) : issues.length === 0 ? (
            <p className="text-xs text-zinc-500">
              {showMiddleStartForm
                ? 'No issues yet. Start a review to open some.'
                : 'No open issues. Run New review for another pass, or follow up with the reviewer in the sidebar.'}
            </p>
          ) : (
            issues.map((issue) => (
              <SessionIssueCard
                key={issue.id}
                issue={issue}
                readonly={readonly}
                saving={savingIssueId === issue.id}
                onStatusChange={handleIssueStatus}
                onDelete={handleDeleteIssue}
                onFix={handleFixIssue}
                onSave={handleIssueSave}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
