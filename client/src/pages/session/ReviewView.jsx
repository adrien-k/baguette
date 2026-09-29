import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  PanelRight,
  Play,
  Square,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
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
import {
  COMPOSER_STOP_BUTTON_CLASS,
  NEUTRAL_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../../utils/buttonStyles.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { sortIssuesBySeverity } from '@baguette/shared/session-issues.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import { availableAgentSdks } from '@baguette/shared/agent-sdk-credentials.js';
import { pickPreferredVariantIdx } from '../../utils/models.js';
import AgentMessageComposer from '../../components/AgentMessageComposer.jsx';
import { CHAT_COLUMN_CLASS } from '../../components/ChatMessagesViewport.jsx';
import SessionIssueCard from '../../components/SessionIssueCard.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';

const REVIEW_FOCUS_PLACEHOLDER = 'Anything specific to focus on? (optional)';

const ISSUE_SECTION_HEADING_CLASS = 'text-xs font-medium text-faint uppercase tracking-wide';

function AllIssuesFixedMessage() {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-success">
      <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
      All issues fixed!
    </p>
  );
}

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

/** Stacked until the follow-up card is wide enough for a single nowrap row. */
const REVIEW_CONTROLS_ROW_CLASS =
  'flex flex-col gap-2 @min-[36rem]:flex-row @min-[36rem]:flex-nowrap @min-[36rem]:items-center';

const REVIEW_ACTION_BUTTON_SIZE_CLASS =
  'inline-flex items-center justify-center gap-1.5 w-full whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium @min-[36rem]:w-auto';

function ReviewerPanelLink({ onClick, label = 'Open reviewer panel', className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 w-full whitespace-nowrap text-xs text-faint hover:text-secondary underline @min-[36rem]:w-auto @min-[36rem]:ml-auto shrink-0 ${className}`}
    >
      <PanelRight className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

export default function ReviewView({
  session,
  readonly,
  issues,
  issuesLoading,
  reviewerDrawerOpen = true,
  reviewerPanelActive = false,
  onOpenReviewer,
}) {
  const { user } = useAuth();
  const { repos } = useRepoContext();
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const { hash } = useLocation();
  const [userSettings, setUserSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [starting, setStarting] = useState(false);
  const [closedCount, setClosedCount] = useState(0);
  const [closedCountLoading, setClosedCountLoading] = useState(false);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [closedIssues, setClosedIssues] = useState([]);
  const [closedLoading, setClosedLoading] = useState(false);
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
  const activeIssues = useMemo(() => issues.filter((i) => i.status !== 'ignored'), [issues]);
  const ignoredIssues = useMemo(() => issues.filter((i) => i.status === 'ignored'), [issues]);
  const showIgnoredSection = ignoredIssues.length > 0;
  const showClosedSection = closedCount > 0;
  const onlyClosedIssues = issues.length === 0 && showClosedSection;
  const hasVisibleIssues = issues.length > 0 || showClosedSection;
  const isRunning = session?.review_status === 'running';
  const reviewStatus = session?.review_status;
  const hasReviewThread = isRunning || reviewStatus === 'completed' || reviewStatus === 'failed';
  const hasSdkKey = !userSettings || availableSdks.includes(reviewAgentSdk);
  const showStartForm = !hasReviewThread && !starting;
  const showFollowUpPanel = hasReviewThread || isRunning;
  const hasReview = hasReviewThread || isRunning;
  const showReviewerPanelLink =
    hasReview && onOpenReviewer && !(reviewerDrawerOpen && reviewerPanelActive);

  useEffect(() => {
    if (!hash.startsWith('#issue-') || issuesLoading) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, issuesLoading, issues]);

  const refreshClosedCount = () => {
    if (!session?.id) {
      setClosedCount(0);
      setClosedCountLoading(false);
      return;
    }
    setClosedCountLoading(true);
    sessionIssuesService
      .find({ query: { session_id: session.id, status: 'closed', $limit: 0 } })
      .then((res) => {
        const total = Array.isArray(res) ? res.length : (res?.total ?? 0);
        setClosedCount(total);
      })
      .catch(() => {})
      .finally(() => setClosedCountLoading(false));
  };

  useEffect(() => {
    refreshClosedCount();
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    const matches = (item) => item?.session_id === session.id;
    const onIssueClosed = (item) => {
      if (!matches(item) || item.status !== 'closed') return;
      refreshClosedCount();
      setClosedIssues((prev) =>
        prev.some((i) => i.id === item.id) ? prev : sortIssuesBySeverity([...prev, item])
      );
    };
    sessionIssuesService.on('patched', onIssueClosed);
    return () => sessionIssuesService.off('patched', onIssueClosed);
  }, [session?.id]);

  const loadClosedIssues = async () => {
    if (!session?.id || closedLoading) return;
    setClosedLoading(true);
    try {
      const res = await sessionIssuesService.find({
        query: { session_id: session.id, status: 'closed', $sort: { id: 1 }, $limit: 100 },
      });
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setClosedIssues(list);
    } catch (err) {
      toastError('Failed to load closed issues', err);
    } finally {
      setClosedLoading(false);
    }
  };

  const toggleClosedSection = async () => {
    const next = !closedExpanded;
    setClosedExpanded(next);
    if (next && closedIssues.length === 0) {
      await loadClosedIssues();
    }
  };

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

  const renderIssueCard = (issue, { archived = false } = {}) => (
    <SessionIssueCard
      key={issue.id}
      issue={issue}
      models={models}
      readonly={readonly || archived}
      saving={savingIssueId === issue.id}
      onStatusChange={handleIssueStatus}
      onDelete={readonly || archived ? undefined : handleDeleteIssue}
      onFix={handleFixIssue}
      onSave={handleIssueSave}
    />
  );

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
    <div className={REVIEW_CONTROLS_ROW_CLASS}>
      <button
        type="button"
        onClick={handleReviewNewCommits}
        disabled={reviewingNewCommits}
        className={`${REVIEW_ACTION_BUTTON_SIZE_CLASS} bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand`}
      >
        {reviewingNewCommits ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        Review latest changes
      </button>
      <button
        type="button"
        onClick={() => setShowClearReviewModal(true)}
        className={`${NEUTRAL_BUTTON_CLASS} ${REVIEW_ACTION_BUTTON_SIZE_CLASS}`}
      >
        Review the entire session
      </button>
      {showReviewerPanelLink && <ReviewerPanelLink onClick={onOpenReviewer} />}
    </div>
  );

  const runningReviewStatus = isRunning && (
    <div className={REVIEW_CONTROLS_ROW_CLASS}>
      <div className="flex w-full items-center justify-center gap-2 min-w-0 @min-[36rem]:w-auto @min-[36rem]:flex-1 @min-[36rem]:justify-start">
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
          <span className="absolute inset-0 rounded-full bg-brand/15 motion-safe:animate-pulse" />
          <Bot className="relative h-4 w-4 text-accent motion-safe:animate-pulse" aria-hidden />
        </div>
        <p className="text-sm font-medium text-heading whitespace-nowrap">Review in progress</p>
      </div>
      {showReviewerPanelLink && <ReviewerPanelLink onClick={onOpenReviewer} />}
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
                  className="text-xs text-accent hover:text-accent underline"
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
                userSettings={userSettings}
                sdkRepo={selectedRepo}
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
            <div className="@container w-full bg-nav border border-line rounded-lg p-4 sm:p-5 space-y-4">
              {userSettings && !hasSdkKey && (
                <Alert variant="alert">
                  Add a {reviewAgentSdk === 'cursor' ? 'Cursor' : 'Claude'} API key in{' '}
                  <Link to="/settings?tab=agent">Settings → Agent</Link> to run a review.
                </Alert>
              )}
              {isRunning ? runningReviewStatus : followUpReviewControls}
            </div>
          )}
          {!readonly && opened.length > 0 && (
            <div className="flex justify-stretch sm:justify-end">
              <button
                type="button"
                onClick={handleFixAllOpened}
                className={`${SECONDARY_BUTTON_CLASS} w-full sm:w-auto justify-center`}
              >
                Fix all opened ({opened.length})
              </button>
            </div>
          )}
          {issuesLoading ? (
            <p className="text-xs text-faint">Loading issues…</p>
          ) : !hasVisibleIssues ? (
            !isRunning &&
            (showStartForm ? (
              <p className="text-xs text-faint">No issues yet. Start a review to open some.</p>
            ) : closedCountLoading || issuesLoading ? (
              <p className="text-xs text-faint">Loading issues…</p>
            ) : (
              <p className="text-xs text-faint">
                No issues yet. Review latest changes for another pass.
              </p>
            ))
          ) : (
            <>
              {onlyClosedIssues && !isRunning && <AllIssuesFixedMessage />}
              {showIgnoredSection ? (
                <>
                  {activeIssues.length > 0 && (
                    <section className="space-y-4">
                      <h2 className={ISSUE_SECTION_HEADING_CLASS}>Issues</h2>
                      {activeIssues.map((issue) => renderIssueCard(issue))}
                    </section>
                  )}
                  <section
                    className={`space-y-4 ${activeIssues.length > 0 ? 'border-t border-line pt-4' : ''}`}
                  >
                    <h2 className={ISSUE_SECTION_HEADING_CLASS}>Ignored</h2>
                    {ignoredIssues.map((issue) => renderIssueCard(issue))}
                  </section>
                </>
              ) : (
                issues.map((issue) => renderIssueCard(issue))
              )}
              {showClosedSection && (
                <section
                  className={`space-y-4 ${issues.length > 0 ? 'border-t border-line pt-4' : ''}`}
                >
                  <button
                    type="button"
                    onClick={toggleClosedSection}
                    className={`${ISSUE_SECTION_HEADING_CLASS} flex w-full items-center gap-1.5 text-left hover:text-secondary`}
                  >
                    {closedExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    Closed ({closedCount})
                  </button>
                  {closedExpanded && (
                    <div className="space-y-4">
                      {closedLoading ? (
                        <p className="text-xs text-faint">Loading closed issues…</p>
                      ) : (
                        closedIssues.map((issue) => renderIssueCard(issue, { archived: true }))
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
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
