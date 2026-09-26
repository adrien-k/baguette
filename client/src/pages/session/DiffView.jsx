import { useState, useEffect, useCallback } from 'react';
import {
  GitMerge,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlignLeft,
  Columns2,
} from 'lucide-react';
import { sessionsService } from '../../feathers.js';
import toast from 'react-hot-toast';
import PrStatusBadge from '../../components/PrStatusBadge.jsx';
import MergeConfirmModal from '../../components/MergeConfirmModal.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

const DIFF_HUNK_ROW = 'text-sky-400 bg-sky-500/10';
const DIFF_HUNK_NUM = 'text-sky-500/70';
const DIFF_REMOVED_ROW = 'text-red-400 bg-red-500/10';
const DIFF_ADDED_ROW = 'text-emerald-400 bg-emerald-500/10';
const DIFF_CONTEXT_ROW = 'text-zinc-400 hover:bg-zinc-800/30';
const DIFF_EMPTY_SIDE = 'flex bg-zinc-800/20';

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

const NUM_CLS = 'w-10 shrink-0 text-right text-zinc-600 select-none pr-2 border-r border-zinc-800';

function lineRefFromRow(row, filePath) {
  if (row.type === 'hunk') return null;
  if (row.type === 'added' && row.newNum) return { path: filePath, line: row.newNum };
  if (row.type === 'removed' && row.oldNum) return { path: filePath, line: row.oldNum };
  const line = row.newNum ?? row.oldNum;
  if (!line) return null;
  return { path: filePath, line };
}

function DiffCodeRow({ rowClass, onLineReference, title, children }) {
  const clickable = Boolean(onLineReference);
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={title}
      onClick={clickable ? onLineReference : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onLineReference();
              }
            }
          : undefined
      }
      className={`flex ${rowClass} ${clickable ? 'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-amber-500/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-amber-500/50' : ''}`}
    >
      {children}
    </div>
  );
}

function InlineDiff({ lines, filePath, onLineReference }) {
  const rows = buildInlineRows(lines);
  const sendRef = (row) => {
    const ref = lineRefFromRow(row, filePath);
    if (ref) onLineReference?.(ref);
  };
  return (
    <div className="font-mono text-xs leading-5">
      {rows.map((row, i) => {
        if (row.type === 'hunk') {
          return (
            <div key={i} className={`flex ${DIFF_HUNK_ROW}`}>
              <span className={`${NUM_CLS} ${DIFF_HUNK_NUM}`}></span>
              <span className={`${NUM_CLS} ${DIFF_HUNK_NUM}`}></span>
              <span className="px-2 flex-1">{row.content}</span>
            </div>
          );
        }
        if (row.type === 'removed') {
          return (
            <DiffCodeRow
              key={i}
              rowClass={DIFF_REMOVED_ROW}
              onLineReference={onLineReference ? () => sendRef(row) : undefined}
              title={onLineReference ? 'Send line reference to chat' : undefined}
            >
              <span className={NUM_CLS}>{row.oldNum}</span>
              <span className={NUM_CLS}></span>
              <span className="px-2 flex-1 whitespace-pre">{row.content || ' '}</span>
            </DiffCodeRow>
          );
        }
        if (row.type === 'added') {
          return (
            <DiffCodeRow
              key={i}
              rowClass={DIFF_ADDED_ROW}
              onLineReference={onLineReference ? () => sendRef(row) : undefined}
              title={onLineReference ? 'Send line reference to chat' : undefined}
            >
              <span className={NUM_CLS}></span>
              <span className={NUM_CLS}>{row.newNum}</span>
              <span className="px-2 flex-1 whitespace-pre">{row.content || ' '}</span>
            </DiffCodeRow>
          );
        }
        return (
          <DiffCodeRow
            key={i}
            rowClass={DIFF_CONTEXT_ROW}
            onLineReference={onLineReference ? () => sendRef(row) : undefined}
            title={onLineReference ? 'Send line reference to chat' : undefined}
          >
            <span className={NUM_CLS}>{row.oldNum}</span>
            <span className={NUM_CLS}>{row.newNum}</span>
            <span className="px-2 flex-1 whitespace-pre">{row.content || ' '}</span>
          </DiffCodeRow>
        );
      })}
    </div>
  );
}

function SideBySideDiff({ lines, filePath, onLineReference }) {
  const rows = buildSideBySideRows(lines);
  const sendRef = (line) => {
    if (line?.num) onLineReference?.({ path: filePath, line: line.num });
  };
  return (
    <div className="font-mono text-xs leading-5 flex divide-x divide-zinc-800">
      {/* Left column */}
      <div className="flex-1 min-w-0">
        {rows.map((row, i) => {
          if (row.type === 'hunk') {
            return (
              <div key={i} className={`${DIFF_HUNK_ROW} px-2`}>
                {row.content}
              </div>
            );
          }
          if (row.type === 'change') {
            return row.left ? (
              <DiffCodeRow
                key={i}
                rowClass={DIFF_REMOVED_ROW}
                onLineReference={onLineReference ? () => sendRef(row.left) : undefined}
                title={onLineReference ? 'Send line reference to chat' : undefined}
              >
                <span className={NUM_CLS}>{row.left.num}</span>
                <span className="px-2 flex-1 whitespace-pre overflow-hidden">
                  {row.left.content || ' '}
                </span>
              </DiffCodeRow>
            ) : (
              <div key={i} className={DIFF_EMPTY_SIDE}>
                <span className={NUM_CLS}></span>
                <span className="px-2 flex-1"> </span>
              </div>
            );
          }
          return (
            <DiffCodeRow
              key={i}
              rowClass={DIFF_CONTEXT_ROW}
              onLineReference={onLineReference ? () => sendRef(row.left) : undefined}
              title={onLineReference ? 'Send line reference to chat' : undefined}
            >
              <span className={NUM_CLS}>{row.left?.num}</span>
              <span className="px-2 flex-1 whitespace-pre overflow-hidden">
                {row.left?.content || ' '}
              </span>
            </DiffCodeRow>
          );
        })}
      </div>
      {/* Right column */}
      <div className="flex-1 min-w-0">
        {rows.map((row, i) => {
          if (row.type === 'hunk') {
            return (
              <div key={i} className={`${DIFF_HUNK_ROW} px-2`}>
                {row.content}
              </div>
            );
          }
          if (row.type === 'change') {
            return row.right ? (
              <DiffCodeRow
                key={i}
                rowClass={DIFF_ADDED_ROW}
                onLineReference={onLineReference ? () => sendRef(row.right) : undefined}
                title={onLineReference ? 'Send line reference to chat' : undefined}
              >
                <span className={NUM_CLS}>{row.right.num}</span>
                <span className="px-2 flex-1 whitespace-pre overflow-hidden">
                  {row.right.content || ' '}
                </span>
              </DiffCodeRow>
            ) : (
              <div key={i} className={DIFF_EMPTY_SIDE}>
                <span className={NUM_CLS}></span>
                <span className="px-2 flex-1"> </span>
              </div>
            );
          }
          return (
            <DiffCodeRow
              key={i}
              rowClass={DIFF_CONTEXT_ROW}
              onLineReference={onLineReference ? () => sendRef(row.right) : undefined}
              title={onLineReference ? 'Send line reference to chat' : undefined}
            >
              <span className={NUM_CLS}>{row.right?.num}</span>
              <span className="px-2 flex-1 whitespace-pre overflow-hidden">
                {row.right?.content || ' '}
              </span>
            </DiffCodeRow>
          );
        })}
      </div>
    </div>
  );
}

function FileDiff({ file, viewMode, scrollId, onLineReference }) {
  const [collapsed, setCollapsed] = useState(false);
  const displayPath = file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
  return (
    <div id={scrollId} className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800 text-left transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        )}
        <span className="font-mono text-xs text-zinc-200 flex-1 truncate">{displayPath}</span>
        <span className="text-xs text-emerald-400 shrink-0">+{file.addedCount}</span>
        <span className="text-xs text-red-400 shrink-0 ml-1">-{file.removedCount}</span>
      </button>
      {!collapsed && (
        <div className="overflow-x-auto bg-zinc-900">
          {viewMode === 'inline' ? (
            <InlineDiff
              lines={file.lines}
              filePath={displayPath}
              onLineReference={onLineReference}
            />
          ) : (
            <SideBySideDiff
              lines={file.lines}
              filePath={displayPath}
              onLineReference={onLineReference}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function DiffView({ session, onFilesChange, onLineReference, readonly }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);
  const [viewMode, setViewMode] = useState('inline');

  const prStatus = session?.pr_status ?? null;
  const isMerged = prStatus === 'merged';
  const canMerge =
    !!session?.pr_number && (prStatus === 'open' || prStatus === 'draft' || prStatus === null);

  const sessionId = session?.id;
  const fetchDiff = useCallback(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    sessionsService
      .diff(sessionId)
      .then((res) => setDiff(res.diff || ''))
      .catch((err) => setError(err.message || 'Failed to load diff'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  const handleMerge = async () => {
    setMerging(true);
    setMergeError(null);
    try {
      await sessionsService.merge(session.id);
      setShowMergeModal(false);
      toast.success('PR merged successfully');
    } catch (err) {
      setMergeError(err.message || 'Failed to merge PR');
    } finally {
      setMerging(false);
    }
  };

  const hasDiff = diff && diff.trim().length > 0;
  const hasPr = !!session?.pr_number;
  const files = hasDiff ? parseDiff(diff) : [];

  useEffect(() => {
    onFilesChange?.(files);
  }, [diff]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Diff content */}
      <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
          </div>
        )}
        {!loading && error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {!loading && !error && !hasDiff && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-500 text-sm">
            <p>
              No changes compared to <span className="text-zinc-400">{session.base_branch}</span>
            </p>
          </div>
        )}
        {!loading && !error && hasDiff && (
          <div className="space-y-3">
            {/* Header: file count + view mode toggle */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">
                {files.length} file{files.length !== 1 ? 's' : ''} changed
                {onLineReference && !readonly && (
                  <span className="text-zinc-600"> · click a line to reference it in chat</span>
                )}
              </span>
              <div className="flex items-center gap-0.5 bg-zinc-800 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('inline')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${viewMode === 'inline' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                  Inline
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${viewMode === 'split' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  Split
                </button>
              </div>
            </div>
            {/* Per-file diffs */}
            {files.map((file, i) => (
              <FileDiff
                key={i}
                file={file}
                viewMode={viewMode}
                scrollId={`diff-file-${i}`}
                onLineReference={readonly ? undefined : onLineReference}
              />
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t border-zinc-800 px-4 py-3 flex items-center justify-between gap-3">
        <button
          onClick={fetchDiff}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <div className="flex items-center gap-2">
          {hasPr && (
            <>
              <PrStatusBadge
                status={prStatus}
                prNumber={session.pr_number}
                prUrl={session.pr_url}
              />
              {!isMerged && canMerge && (
                <button onClick={() => setShowMergeModal(true)} className={SECONDARY_BUTTON_CLASS}>
                  <GitMerge className="w-3.5 h-3.5" />
                  Merge PR
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showMergeModal && (
        <MergeConfirmModal
          prNumber={session.pr_number}
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
