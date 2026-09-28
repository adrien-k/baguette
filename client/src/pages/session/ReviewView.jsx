import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, PanelRight, Play, Square } from 'lucide-react';
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
import Alert from '../../components/Alert.jsx';
import ClearReviewConfirmModal from '../../components/ClearReviewConfirmModal.jsx';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { COMPOSER_STOP_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useGetSessionIssues } from '../../hooks/useGetSessionIssues.js';
import { useGetReviewMessages } from '../../hooks/useGetReviewMessages.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import { availableAgentSdks } from '@baguette/shared/agent-sdk-credentials.js';
import { pickPreferredVariantIdx } from '../../utils/models.js';
import AgentMessageComposer from '../../components/AgentMessageComposer.jsx';
import { CHAT_COLUMN_CLASS } from '../../components/ChatMessagesViewport.jsx';
import SessionIssueCard from '../../components/SessionIssueCard.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';

const REVIEW_FOCUS_PLACEHOLDER = 'Anything specific to focus on? (optional)';

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

export default function ReviewView({
  session,
  readonly,
  reviewerDrawerOpen = true,
  onOpenReviewer,
}) {
  const { user } = useAuth();
  const { repos } = useRepoContext();
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const { issues, loading: issuesLoading } = useGetSessionIssues(session?.id);
  const { messages: reviewMessages, loading: reviewMessagesLoading } = useGetReviewMessages(
    session?.id
  );
  const [userSettings, setUserSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [starting, setStarting] = useState(false);
  const [reviewingNewCommits, setReviewingNewCommits] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [clearingReview, setClearingReview] = useState(false);
  const [showClearReviewModal, setShowClearReviewModal] = useState(false);
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

  const hasStoredReviewSdk = session?.review_agent_sdk != null && session.review_agent_sdk !== '';
  const reviewAgentSdk = hasStoredReviewSdk
    ? session.review_agent_sdk
    : session?.agent_sdk || 'claude';
  const reviewModel = hasStoredReviewSdk
    ? session?.review_model || ''
    : session?.review_model || session?.model || '';
  const reviewModelParams = hasStoredReviewSdk
    ? (session?.review_model_params ?? null)
    : (session?.review_model_params ?? session?.model_params ?? null);

  useEffect(() => {
    if (!session?.id || readonly) return;
    if (session.review_agent_sdk != null || session.review_model != null) return;
    if (session.model == null && session.model_params == null && !session.agent_sdk) return;
    sessionsService
      .patch(session.id, {
        review_agent_sdk: session.agent_sdk || 'claude',
        review_model: session.model || null,
        review_model_params: session.model_params ?? null,
      })
      .catch((err) => toastError('Failed to initialize review model', err));
  }, [
    session?.id,
    session?.review_agent_sdk,
    session?.review_model,
    session?.model,
    session?.model_params,
    session?.agent_sdk,
    readonly,
  ]);

  useEffect(() => {
    setModels([]);
    const url =
      reviewAgentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    apiFetch(url)
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
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
  const hasReviewThread = reviewMessages.length > 0;
  const hasSdkKey = !userSettings || availableSdks.includes(reviewAgentSdk);
  const showStartForm = !hasReviewThread && !isRunning && !starting && !reviewMessagesLoading;
  const showFollowUpPanel = hasReviewThread || isRunning;

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
    } catch (err) {
      toastError('Failed to start review', err);
    } finally {
      setStarting(false);
    }
  };

  const handleReviewNewCommits = async () => {
    if (!session?.id || reviewingNewCommits || isRunning) return;
    setReviewingNewCommits(true);
    try {
      await sessionReviewService.reviewNewCommits({ session_id: session.id });
    } catch (err) {
      toastError('Failed to review latest changes', err);
    } finally {
      setReviewingNewCommits(false);
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

  const handleClearReview = async () => {
    if (!session?.id || clearingReview || isRunning) return;
    setClearingReview(true);
    try {
      await sessionReviewService.clearContext({ session_id: session.id });
      setReviewUserMessage('');
      setShowClearReviewModal(false);
    } catch (err) {
      toastError('Failed to review the entire change', err);
    } finally {
      setClearingReview(false);
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

  const handleReviewSdkChange = async (sdk) => {
    if (!session?.id || readonly || !sdk || sdk === reviewAgentSdk) return;
    try {
      await sessionsService.patch(session.id, {
        review_agent_sdk: sdk,
        review_model: null,
        review_model_params: null,
      });
    } catch (err) {
      toastError('Failed to update review agent', err);
    }
  };

  useEffect(() => {
    if (!session?.id || readonly || !models.length) return;
    if (reviewModel && models.some((m) => m.id === reviewModel)) return;
    const first = models[0];
    if (!first) return;
    const isCursor = reviewAgentSdk === 'cursor';
    const variants = first.variants ?? [];
    let paramsJson = null;
    if (isCursor && variants.length) {
      const prefIdx = pickPreferredVariantIdx(variants, cursorModelPrefs);
      const prefVariant = prefIdx >= 0 ? variants[prefIdx] : variants[0];
      paramsJson = prefVariant?.params?.length ? JSON.stringify(prefVariant.params) : null;
    }
    handleReviewModelChange(first.id, paramsJson);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default the review model once the SDK's list loads
  }, [models, reviewModel, reviewAgentSdk, readonly, session?.id]);

  const followUpReviewControls = !readonly && showFollowUpPanel && !isRunning && (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleReviewNewCommits}
        disabled={reviewingNewCommits}
        className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-3 py-1.5 rounded-lg text-sm font-medium"
      >
        {reviewingNewCommits ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        Review latest changes
      </button>
      <div className="flex-1 min-w-2" />
      <button
        type="button"
        onClick={() => setShowClearReviewModal(true)}
        className="text-xs text-zinc-500 hover:text-zinc-300 underline shrink-0"
      >
        Review the entire change
      </button>
    </div>
  );

  const runningReviewStatus = isRunning && (
    <div className="relative flex flex-wrap items-center gap-2">
      {!readonly && (
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          title="Stop"
          className={COMPOSER_STOP_BUTTON_CLASS}
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
      )}
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-amber-400/15 motion-safe:animate-pulse" />
        <Bot className="relative h-4 w-4 text-amber-400 motion-safe:animate-pulse" aria-hidden />
      </div>
      <p className="text-sm font-medium text-zinc-200">Review in progress</p>
      <div className="flex-1 min-w-2" />
      {!reviewerDrawerOpen && onOpenReviewer && (
        <button
          type="button"
          onClick={onOpenReviewer}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 underline shrink-0"
        >
          <PanelRight className="h-3.5 w-3.5" />
          Open the reviewer
        </button>
      )}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {showStartForm && (
        <div className="shrink-0 overflow-auto">
          <div className={`${CHAT_COLUMN_CLASS} py-4 sm:py-6 space-y-4`}>
            {userSettings && !hasSdkKey && (
              <Alert variant="alert">
                Add a {reviewAgentSdk === 'cursor' ? 'Cursor' : 'Claude'} API key in{' '}
                <Link to="/settings?tab=agent">Settings → Agent</Link> to run a review.
              </Alert>
            )}
            <div>
              <div className="flex flex-wrap items-baseline justify-end gap-2 mb-1">
                <Link
                  to="/settings?tab=prompts#settings-prompt-review"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-amber-400 hover:text-amber-300 underline"
                >
                  Configure the system prompt
                </Link>
              </div>
              <AgentMessageComposer
                skipColumn
                formClassName=""
                resizable
                value={reviewUserMessage}
                onChange={setReviewUserMessage}
                onSubmit={handleStart}
                placeholder={REVIEW_FOCUS_PLACEHOLDER}
                disabled={readonly}
                sending={starting}
                session={sessionForReviewComposer}
                models={models}
                cursorModelPrefs={cursorModelPrefs}
                onCursorModelPrefChange={setCursorModelPref}
                onModelChange={handleReviewModelChange}
                availableSdks={availableSdks}
                onSdkChange={handleReviewSdkChange}
                canSend={canStartReview}
                submitLabel="Start review"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <div className={`${CHAT_COLUMN_CLASS} py-3 sm:py-4 space-y-4`}>
          {showFollowUpPanel && (
            <div className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5 space-y-4">
              {userSettings && !hasSdkKey && (
                <Alert variant="alert">
                  Add a {reviewAgentSdk === 'cursor' ? 'Cursor' : 'Claude'} API key in{' '}
                  <Link to="/settings?tab=agent">Settings → Agent</Link> to run a review.
                </Alert>
              )}
              {isRunning ? runningReviewStatus : followUpReviewControls}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
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
            !isRunning && (
              <p className="text-xs text-zinc-500">
                {showStartForm
                  ? 'No issues yet. Start a review to open some.'
                  : 'No issues yet. Review latest changes for another pass.'}
              </p>
            )
          ) : (
            issues.map((issue) => (
              <SessionIssueCard
                key={issue.id}
                issue={issue}
                models={models}
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

      {showClearReviewModal && (
        <ClearReviewConfirmModal
          loading={clearingReview}
          onCancel={() => {
            if (!clearingReview) setShowClearReviewModal(false);
          }}
          onConfirm={handleClearReview}
        />
      )}
    </div>
  );
}
