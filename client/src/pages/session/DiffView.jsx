import { useState, useEffect, useCallback } from 'react';

const FINE_POINTER_HOVER_QUERY = '(hover: hover) and (pointer: fine)';

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Comment buttons stay visible; desktop hides them until line hover. */
const DIFF_LINE_COMMENT_BTN_VISIBILITY =
  'opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/diffline:opacity-100';
import {
  GitMerge,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlignLeft,
  Columns2,
  MessageSquarePlus,
} from 'lucide-react';
import { sessionsService } from '../../feathers.js';
import toast from 'react-hot-toast';
import PrStatusBadge from '../../components/PrStatusBadge.jsx';
import PrDraftToggleButton from '../../components/PrDraftToggleButton.jsx';
import MergeConfirmModal from '../../components/MergeConfirmModal.jsx';
import { useMergePrEntry } from '../../hooks/useMergePrEntry.js';
import { useLongPressPointer } from '../../hooks/useLongPressPointer.js';
import DiffLineComposer from '../../components/DiffLineComposer.jsx';
import { useSessionAgents } from '../../hooks/useSessionAgents.js';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { toastFeathersError } from '../../utils/toastError.jsx';
import { mergeFailureToastLabel } from '../../utils/mergeSessionErrors.js';
import { diffFileDisplayPath, diffFileScrollId } from '../../utils/paths.js';
const DIFF_CONTENT_MAX_WIDTH_CLASS = 'w-full max-w-5xl mx-auto';
import { DIFF_FILE_BODY_CLASS, DIFF_LINE_WRAP_CLASS } from '../../utils/diffLineWrap.js';

const DIFF_HUNK_ROW = 'text-info bg-info/10';
const DIFF_HUNK_NUM = 'text-info/70';
const DIFF_REMOVED_ROW = 'text-danger bg-danger/10';
const DIFF_ADDED_ROW = 'text-success bg-success/10';
const DIFF_CONTEXT_ROW = 'text-fg-muted hover:bg-control/30';
const DIFF_EMPTY_SIDE = 'flex bg-control/20';

// Parse unified diff string into per-file sections
function parseDiff(diffText) {
  const files = [];
  let currentFile = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (currentFile) files.push(currentFile);
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      currentFile = {
        oldPath: match ? match[1] : '?',
        newPath: match ? match[2] : '?',
        lines: [],
        addedCount: 0,
        removedCount: 0,
      };
    } else if (currentFile) {
      currentFile.lines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) currentFile.addedCount++;
      if (line.startsWith('-') && !line.startsWith('---')) currentFile.removedCount++;
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

function buildInlineRows(lines) {
  const rows = [];
  let oldNum = 0,
    newNum = 0;
  for (const line of lines) {
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('\\')
    )
      continue;
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNum = parseInt(m[1]);
        newNum = parseInt(m[2]);
      }
      rows.push({ type: 'hunk', content: line });
    } else if (line.startsWith('-')) {
      rows.push({ type: 'removed', oldNum: oldNum++, content: line.slice(1) });
    } else if (line.startsWith('+')) {
      rows.push({ type: 'added', newNum: newNum++, content: line.slice(1) });
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      rows.push({ type: 'context', oldNum: oldNum++, newNum: newNum++, content });
    }
  }
  return rows;
}

function buildSideBySideRows(lines) {
  const rows = [];
  let oldNum = 0,
    newNum = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('\\')
    ) {
      i++;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNum = parseInt(m[1]);
        newNum = parseInt(m[2]);
      }
      rows.push({ type: 'hunk', content: line });
      i++;
      continue;
    }
    if (line.startsWith('-') || line.startsWith('+')) {
      const removed = [],
        added = [];
      while (i < lines.length && (lines[i].startsWith('-') || lines[i].startsWith('+'))) {
        if (lines[i].startsWith('-')) removed.push({ num: oldNum++, content: lines[i].slice(1) });
        else added.push({ num: newNum++, content: lines[i].slice(1) });
        i++;
      }
      const len = Math.max(removed.length, added.length);
      for (let j = 0; j < len; j++) {
        rows.push({ type: 'change', left: removed[j] ?? null, right: added[j] ?? null });
      }
      continue;
    }
    const content = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      type: 'context',
      left: { num: oldNum++, content },
      right: { num: newNum++, content },
    });
    i++;
  }
  return rows;
}

const NUM_CLS = 'w-10 shrink-0 text-right text-faint select-none pr-2 border-r border-line';
const DIFF_LINE_CONTENT_CLS = `px-2 flex-1 ${DIFF_LINE_WRAP_CLASS}`;

/** Which side of the diff the comment targets (`before` = old file, `after` = new file). */
function lineRefFromRow(row, filePath) {
  if (row.type === 'hunk') return null;
  if (row.type === 'removed' && row.oldNum) {
    return { path: filePath, line: row.oldNum, side: 'before', change: 'removed' };
  }
  if (row.type === 'added' && row.newNum) {
    return { path: filePath, line: row.newNum, side: 'after', change: 'added' };
  }
  if (row.type === 'context') {
    if (row.newNum) return { path: filePath, line: row.newNum, side: 'after' };
    if (row.oldNum) return { path: filePath, line: row.oldNum, side: 'before' };
  }
  return null;
}

function DiffCodeRow({ rowClass, onOpenComposer, active, longPressLineToComment, children }) {
  const canOpen = Boolean(onOpenComposer);
  const longPressPointer = useLongPressPointer({
    enabled: longPressLineToComment && canOpen,
    onLongPress: () => onOpenComposer?.(),
  });

  return (
    <div
      className={`group/diffline relative flex w-full min-w-0 items-start ${rowClass} ${
        active ? 'ring-1 ring-inset ring-brand/60' : ''
      } ${longPressLineToComment && canOpen ? 'touch-manipulation' : ''}`}
      {...longPressPointer}
    >
      {canOpen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenComposer();
          }}
          title={LINE_HINT}
          aria-label={LINE_HINT}
          aria-expanded={active}
          className={`z-10 mr-0.5 shrink-0 inline-flex items-center justify-center w-7 h-7 [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:h-9 rounded-md border border-strong bg-control/95 text-secondary shadow-sm transition-opacity hover:bg-control-hover hover:text-fg hover:border-faint touch-manipulation ${
            active ? 'opacity-100' : DIFF_LINE_COMMENT_BTN_VISIBILITY
          }`}
        >
          <MessageSquarePlus
            className="w-3.5 h-3.5 [@media(pointer:coarse)]:w-4 [@media(pointer:coarse)]:h-4"
            strokeWidth={2}
          />
        </button>
      )}
      {children}
    </div>
  );
}

function isLineActive(active, filePath, line, side) {
  if (!active || active.path !== filePath || Number(active.line) !== Number(line)) return false;
  if (active.side != null || side != null) {
    return active.side === side;
  }
  return true;
}

const LINE_HINT = 'Comment on this line';

function InlineDiff({
  lines,
  filePath,
  onLineReference,
  activeLine,
  composer,
  longPressLineToComment,
}) {
  const rows = buildInlineRows(lines);
  const sendRef = (row) => {
    const ref = lineRefFromRow(row, filePath);
    if (ref) onLineReference?.(ref);
  };
  return (
    <div className={`font-mono text-xs leading-5 ${DIFF_FILE_BODY_CLASS}`}>
      {rows.map((row, i) => {
        if (row.type === 'hunk') {
          return (
            <div key={i} className={`flex min-w-0 ${DIFF_HUNK_ROW}`}>
              <span className={`${NUM_CLS} ${DIFF_HUNK_NUM}`}></span>
              <span className={`${NUM_CLS} ${DIFF_HUNK_NUM}`}></span>
              <span className={DIFF_LINE_CONTENT_CLS}>{row.content}</span>
            </div>
          );
        }
        const ref = lineRefFromRow(row, filePath);
        const active = ref ? isLineActive(activeLine, filePath, ref.line, ref.side) : false;
        const openComposer = onLineReference ? () => sendRef(row) : undefined;
        let body;
        if (row.type === 'removed') {
          body = (
            <DiffCodeRow
              rowClass={DIFF_REMOVED_ROW}
              onOpenComposer={openComposer}
              active={active}
              longPressLineToComment={longPressLineToComment}
            >
              <span className={NUM_CLS}>{row.oldNum}</span>
              <span className={NUM_CLS}></span>
              <span className={DIFF_LINE_CONTENT_CLS}>{row.content || ' '}</span>
            </DiffCodeRow>
          );
        } else if (row.type === 'added') {
          body = (
            <DiffCodeRow
              rowClass={DIFF_ADDED_ROW}
              onOpenComposer={openComposer}
              active={active}
              longPressLineToComment={longPressLineToComment}
            >
              <span className={NUM_CLS}></span>
              <span className={NUM_CLS}>{row.newNum}</span>
              <span className={DIFF_LINE_CONTENT_CLS}>{row.content || ' '}</span>
            </DiffCodeRow>
          );
        } else {
          body = (
            <DiffCodeRow
              rowClass={DIFF_CONTEXT_ROW}
              onOpenComposer={openComposer}
              active={active}
              longPressLineToComment={longPressLineToComment}
            >
              <span className={NUM_CLS}>{row.oldNum}</span>
              <span className={NUM_CLS}>{row.newNum}</span>
              <span className={DIFF_LINE_CONTENT_CLS}>{row.content || ' '}</span>
            </DiffCodeRow>
          );
        }
        return (
          <div key={i}>
            {body}
            {active ? composer : null}
          </div>
        );
      })}
    </div>
  );
}

function SideBySideDiff({
  lines,
  filePath,
  onLineReference,
  activeLine,
  composer,
  longPressLineToComment,
}) {
  const rows = buildSideBySideRows(lines);
  const sendRef = (line, side, change) => {
    if (line?.num) onLineReference?.({ path: filePath, line: line.num, side, change });
  };
  return (
    <div className={`font-mono text-xs leading-5 ${DIFF_FILE_BODY_CLASS}`}>
      {rows.map((row, i) => {
        if (row.type === 'hunk') {
          return (
            <div key={i} className={`flex min-w-0 divide-x divide-line ${DIFF_HUNK_ROW}`}>
              <div className={`flex-1 min-w-0 ${DIFF_LINE_CONTENT_CLS}`}>{row.content}</div>
              <div className={`flex-1 min-w-0 ${DIFF_LINE_CONTENT_CLS}`}>{row.content}</div>
            </div>
          );
        }
        const leftActive = row.left?.num
          ? isLineActive(activeLine, filePath, row.left.num, 'before')
          : false;
        const rightActive = row.right?.num
          ? isLineActive(activeLine, filePath, row.right.num, 'after')
          : false;
        const showComposer = leftActive || rightActive;
        const leftCell =
          row.type === 'change' ? (
            row.left ? (
              <DiffCodeRow
                rowClass={DIFF_REMOVED_ROW}
                onOpenComposer={
                  onLineReference ? () => sendRef(row.left, 'before', 'removed') : undefined
                }
                active={leftActive}
                longPressLineToComment={longPressLineToComment}
              >
                <span className={NUM_CLS}>{row.left.num}</span>
                <span className={DIFF_LINE_CONTENT_CLS}>{row.left.content || ' '}</span>
              </DiffCodeRow>
            ) : (
              <div className={DIFF_EMPTY_SIDE}>
                <span className={NUM_CLS}></span>
                <span className="px-2 flex-1"> </span>
              </div>
            )
          ) : (
            <DiffCodeRow
              rowClass={DIFF_CONTEXT_ROW}
              onOpenComposer={onLineReference ? () => sendRef(row.left, 'before') : undefined}
              active={leftActive}
              longPressLineToComment={longPressLineToComment}
            >
              <span className={NUM_CLS}>{row.left?.num}</span>
              <span className={DIFF_LINE_CONTENT_CLS}>{row.left?.content || ' '}</span>
            </DiffCodeRow>
          );
        const rightCell =
          row.type === 'change' ? (
            row.right ? (
              <DiffCodeRow
                rowClass={DIFF_ADDED_ROW}
                onOpenComposer={
                  onLineReference ? () => sendRef(row.right, 'after', 'added') : undefined
                }
                active={rightActive}
                longPressLineToComment={longPressLineToComment}
              >
                <span className={NUM_CLS}>{row.right.num}</span>
                <span className={DIFF_LINE_CONTENT_CLS}>{row.right.content || ' '}</span>
              </DiffCodeRow>
            ) : (
              <div className={DIFF_EMPTY_SIDE}>
                <span className={NUM_CLS}></span>
                <span className="px-2 flex-1"> </span>
              </div>
            )
          ) : (
            <DiffCodeRow
              rowClass={DIFF_CONTEXT_ROW}
              onOpenComposer={onLineReference ? () => sendRef(row.right, 'after') : undefined}
              active={rightActive}
              longPressLineToComment={longPressLineToComment}
            >
              <span className={NUM_CLS}>{row.right?.num}</span>
              <span className={DIFF_LINE_CONTENT_CLS}>{row.right?.content || ' '}</span>
            </DiffCodeRow>
          );
        return (
          <div key={i}>
            <div className="flex min-w-0 divide-x divide-line">
              <div className="flex-1 min-w-0">{leftCell}</div>
              <div className="flex-1 min-w-0">{rightCell}</div>
            </div>
            {showComposer ? composer : null}
          </div>
        );
      })}
    </div>
  );
}

function FileDiff({
  file,
  viewMode,
  scrollId,
  onLineReference,
  activeLine,
  composer,
  longPressLineToComment,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const displayPath = diffFileDisplayPath(file);
  return (
    <div id={scrollId} className="min-w-0 max-w-full border border-line rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-control/50 hover:bg-control text-left transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-faint shrink-0" />
        )}
        <span className="font-mono text-xs text-heading flex-1 truncate">{displayPath}</span>
        <span className="text-xs text-success shrink-0">+{file.addedCount}</span>
        <span className="text-xs text-danger shrink-0 ml-1">-{file.removedCount}</span>
      </button>
      {!collapsed && (
        <div className={`bg-nav ${DIFF_FILE_BODY_CLASS}`}>
          {viewMode === 'inline' ? (
            <InlineDiff
              lines={file.lines}
              filePath={displayPath}
              onLineReference={onLineReference}
              activeLine={activeLine}
              composer={composer}
              longPressLineToComment={longPressLineToComment}
            />
          ) : (
            <SideBySideDiff
              lines={file.lines}
              filePath={displayPath}
              onLineReference={onLineReference}
              activeLine={activeLine}
              composer={composer}
              longPressLineToComment={longPressLineToComment}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function DiffView({
  session,
  selectedCommit = 'all',
  commits = null,
  onSelectedCommitChange,
  onRefreshCommits,
  onRefreshChangedFiles,
  commitsLoading,
  changedFilesLoading,
  diff,
  diffLoading,
  diffError,
  diffStale = false,
  diffHasFetched = false,
  onRefreshDiff,
  fileByFile = false,
  changedFiles = [],
  selectedFile = null,
  onSelectedFileChange,
  scrollToFile,
  onScrolledToFile,
  readonly,
  models,
  onModelChange,
  onAgentConfigChange,
  agentConfigOptions,
  configsLoading = false,
  modelsLoading = false,
  cursorModelPrefs,
  onCursorModelPrefChange,
}) {
  const { primaryBuilder } = useSessionAgents(session?.id);
  const {
    checkingUnpushed: checkingUnpushedForMerge,
    showMergeModal,
    setShowMergeModal,
    unpushedCount: mergeUnpushedCount,
    openMergeFlow,
  } = useMergePrEntry(session);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);
  const [viewMode, setViewMode] = useState('inline');
  const [lineComposer, setLineComposer] = useState(null);
  const finePointerHover = useMediaQuery(FINE_POINTER_HOVER_QUERY);

  const loading = diffLoading;
  const error = diffError;

  const prStatus = session?.pr_status ?? null;
  const isMerged = prStatus === 'merged';
  const canMerge =
    !!session?.pr_number && (prStatus === 'open' || prStatus === 'draft' || prStatus === null);

  const isSingleCommit = selectedCommit && selectedCommit !== 'all';
  const selectedCommitMeta = isSingleCommit
    ? (commits ?? []).find((c) => c.sha === selectedCommit)
    : null;
  /** Branch tip (all-commits diff); git log is newest-first. */
  const branchHeadShortSha = (commits ?? [])[0]?.short_sha ?? null;

  const handleRefresh = useCallback(() => {
    onRefreshCommits?.();
    onRefreshChangedFiles?.();
    onRefreshDiff?.();
  }, [onRefreshCommits, onRefreshChangedFiles, onRefreshDiff]);

  const refreshBusy =
    commitsLoading || loading || (!fileByFile && !isSingleCommit && changedFilesLoading);

  const handleMerge = async ({ archive = false } = {}) => {
    setMerging(true);
    setMergeError(null);
    try {
      await sessionsService.merge({ id: session.id, archive });
      setShowMergeModal(false);
      toast.success(archive ? 'PR merged; archiving session' : 'PR merged successfully');
    } catch (err) {
      toastFeathersError(mergeFailureToastLabel(err), err);
      setMergeError(err.message || mergeFailureToastLabel(err));
    } finally {
      setMerging(false);
    }
  };

  const hasDiff = diff && diff.trim().length > 0;
  const hasPr = !!session?.pr_number;
  const files = hasDiff ? parseDiff(diff) : [];

  useEffect(() => {
    if (fileByFile || !scrollToFile || loading) return;
    const el = document.getElementById(diffFileScrollId(scrollToFile));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onScrolledToFile?.();
  }, [fileByFile, scrollToFile, loading, diff, onScrolledToFile]);

  const canComment = !readonly;
  const longPressLineToComment = canComment && !finePointerHover;
  const enrichLineRef = (ref) => {
    const short_sha = selectedCommitMeta?.short_sha ?? branchHeadShortSha;
    return short_sha ? { ...ref, short_sha } : ref;
  };

  const handleLineClick = (ref) => {
    if (!canComment || !ref) return;
    const next = enrichLineRef(ref);
    setLineComposer((prev) =>
      prev &&
      prev.path === next.path &&
      Number(prev.line) === Number(next.line) &&
      prev.side === next.side
        ? null
        : next
    );
  };
  const lineComposerEl =
    lineComposer && canComment ? (
      <DiffLineComposer
        key={`${lineComposer.path}:${lineComposer.side}:${lineComposer.line}`}
        session={session}
        builderAgent={primaryBuilder}
        path={lineComposer.path}
        line={lineComposer.line}
        shortSha={lineComposer.short_sha}
        change={lineComposer.change}
        models={models}
        cursorModelPrefs={cursorModelPrefs}
        onCursorModelPrefChange={onCursorModelPrefChange}
        onModelChange={onModelChange}
        onAgentConfigChange={readonly ? undefined : onAgentConfigChange}
        agentConfigOptions={agentConfigOptions}
        configsLoading={configsLoading}
        modelsLoading={modelsLoading}
        onClose={() => setLineComposer(null)}
      />
    ) : null;

  const commitSelector =
    onSelectedCommitChange && !session?.is_global ? (
      <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-line/60 bg-inset/50">
        <div className={`${DIFF_CONTENT_MAX_WIDTH_CLASS} flex items-center gap-2 min-w-0`}>
          <label className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[10px] uppercase tracking-wide text-faint shrink-0">Commit</span>
            <select
              value={selectedCommit}
              onChange={(e) => onSelectedCommitChange(e.target.value)}
              className="flex-1 min-w-0 max-w-md text-xs bg-control border border-strong rounded-md px-2 py-1 text-heading focus:outline-none focus:ring-1 focus:ring-brand/50"
            >
              <option value="all">All commits</option>
              {(commits ?? []).map((c) => (
                <option key={c.sha} value={c.sha}>
                  {c.short_sha} — {c.subject}
                </option>
              ))}
            </select>
          </label>
          {onRefreshCommits && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshBusy}
              className="flex items-center gap-1.5 text-xs text-faint hover:text-secondary transition-colors disabled:opacity-40 p-1 shrink-0"
              title={isSingleCommit ? 'Refresh commits' : 'Refresh commits and diff'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshBusy ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
      </div>
    ) : null;

  const fileSelectorOptions =
    fileByFile && changedFiles.length > 0
      ? changedFiles
      : fileByFile && selectedFile
        ? [{ oldPath: selectedFile, newPath: selectedFile }]
        : [];
  const fileSelector =
    fileByFile && onSelectedFileChange && fileSelectorOptions.length > 0 ? (
      <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-line/60 bg-inset/30">
        <div className={`${DIFF_CONTENT_MAX_WIDTH_CLASS} flex items-center gap-2 min-w-0`}>
          <label className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[10px] uppercase tracking-wide text-faint shrink-0">File</span>
            <select
              value={selectedFile ?? ''}
              onChange={(e) => onSelectedFileChange(e.target.value)}
              className="flex-1 min-w-0 max-w-md text-xs bg-control border border-strong rounded-md px-2 py-1 text-heading focus:outline-none focus:ring-1 focus:ring-brand/50 font-mono"
            >
              {fileSelectorOptions.map((f) => {
                const path = diffFileDisplayPath(f);
                return (
                  <option key={path} value={path}>
                    {path}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="text-[10px] text-faint shrink-0 hidden sm:inline">
            Diff too large — one file at a time
          </span>
        </div>
      </div>
    ) : null;

  const showDiffRefreshBanner = !loading && diffStale && diffHasFetched;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
      {commitSelector}
      {fileSelector}
      {showDiffRefreshBanner && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-3 pt-2">
          <div
            className={`pointer-events-auto ${DIFF_CONTENT_MAX_WIDTH_CLASS} flex items-center justify-between gap-3 rounded-lg border border-brand/40 bg-nav/95 backdrop-blur-sm px-3 py-2 shadow-md`}
          >
            <span className="text-xs text-secondary">
              The diff may be out of date. Refresh to load the latest changes.
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshBusy}
              className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand hover:text-brand/90 disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshBusy ? 'animate-spin' : ''}`} />
              Refresh diff
            </button>
          </div>
        </div>
      )}
      {/* Diff content */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4">
        <div className={`${DIFF_CONTENT_MAX_WIDTH_CLASS} min-h-full`}>
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-strong border-t-secondary rounded-full animate-spin" />
            </div>
          )}
          {!loading && error && (
            <div className="flex items-center gap-2 text-danger text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {!loading && !error && diffHasFetched && !hasDiff && !diffStale && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-faint text-sm">
              <p>
                {isSingleCommit ? (
                  'No changes in this commit.'
                ) : (
                  <>
                    No changes compared to{' '}
                    <span className="text-fg-muted">{session.base_branch}</span>
                  </>
                )}
              </p>
            </div>
          )}
          {!loading && !error && hasDiff && (
            <div className="space-y-3">
              {/* Header: file count + view mode toggle */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-faint">
                  {fileByFile
                    ? changedFilesLoading && changedFiles.length === 0
                      ? 'Showing current file'
                      : `Showing 1 of ${changedFiles.length || fileSelectorOptions.length} changed files`
                    : `${files.length} file${files.length !== 1 ? 's' : ''} changed`}
                  {canComment && (
                    <span className="text-faint">
                      {' '}
                      ·{' '}
                      {finePointerHover ? (
                        <>
                          hover a line and use{' '}
                          <MessageSquarePlus className="inline w-3 h-3 align-text-bottom" /> to
                          message the agent
                        </>
                      ) : (
                        <>
                          long-press a line or{' '}
                          <MessageSquarePlus className="inline w-3 h-3 align-text-bottom" /> to
                          message the agent
                        </>
                      )}
                    </span>
                  )}
                  {isSingleCommit && selectedCommitMeta && (
                    <span className="text-fg-muted hidden sm:inline">
                      · {selectedCommitMeta.subject}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-0.5 bg-control rounded-lg p-0.5">
                  <button
                    onClick={() => setViewMode('inline')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${viewMode === 'inline' ? 'bg-control-hover text-fg' : 'text-fg-muted hover:text-heading'}`}
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                    Inline
                  </button>
                  <button
                    onClick={() => setViewMode('split')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${viewMode === 'split' ? 'bg-control-hover text-fg' : 'text-fg-muted hover:text-heading'}`}
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    Split
                  </button>
                </div>
              </div>
              {/* Per-file diffs */}
              {files.map((file) => (
                <FileDiff
                  key={diffFileDisplayPath(file)}
                  file={file}
                  viewMode={viewMode}
                  scrollId={diffFileScrollId(file)}
                  onLineReference={canComment ? handleLineClick : undefined}
                  activeLine={lineComposer}
                  composer={lineComposerEl}
                  longPressLineToComment={longPressLineToComment}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {hasPr && (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <div className={`${DIFF_CONTENT_MAX_WIDTH_CLASS} flex items-center justify-end gap-2`}>
            <PrStatusBadge status={prStatus} prNumber={session.pr_number} prUrl={session.pr_url} />
            {!readonly && <PrDraftToggleButton session={session} />}
            {!isMerged && canMerge && !readonly && (
              <button
                onClick={openMergeFlow}
                disabled={checkingUnpushedForMerge}
                className={SECONDARY_BUTTON_CLASS}
              >
                <GitMerge className="w-3.5 h-3.5" />
                Merge PR
              </button>
            )}
          </div>
        </div>
      )}

      {showMergeModal && (
        <MergeConfirmModal
          prNumber={session.pr_number}
          commitsToPush={mergeUnpushedCount}
          onConfirm={handleMerge}
          onCancel={() => {
            setShowMergeModal(false);
            setMergeError(null);
          }}
          loading={merging}
          error={mergeError}
        />
      )}
    </div>
  );
}
