import { useEffect, useRef, useState } from 'react';
import { Check, GitBranch, HelpCircle, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import Tooltip from './Tooltip.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';

const HELP_TEXT =
  'With session auto-push on, normal GitPush to these branches skips approval (including from subagents). Auto-push off still asks each time; force push always asks.';

function parseTypedBranches(raw) {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeBranches(current, additions) {
  const next = [...current];
  for (const name of additions) {
    if (!next.includes(name)) {
      next.push(name);
    }
  }
  return next;
}

function branchRowBadge(branch, defaultBranch, isRemoteKnown) {
  if (branch === defaultBranch) return 'default';
  if (!isRemoteKnown) return 'custom';
  return null;
}

/**
 * Per-repository auto-push branch manager: scannable branch chips with a lazy-loaded
 * searchable branch picker supporting both repository branches and custom branch names.
 */
export default function RepoFixedPushBranchesControl({ repo, saving = false, onSave }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const inputRef = useRef(null);

  const selected = Array.isArray(repo?.agent_fixed_push_branches)
    ? repo.agent_fixed_push_branches
    : [];

  const {
    branches: repoBranches,
    loading: loadingBranches,
    clearCacheAndReload,
    clearingCache,
  } = useGetBranches(open ? repo : null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(id);
  }, [justSaved, savedTick]);

  const persistBranches = async (nextBranches) => {
    const ok = await onSave(repo, nextBranches);
    if (ok) {
      setJustSaved(true);
      setSavedTick((n) => n + 1);
    }
  };

  const handleToggle = (branch) => {
    if (saving) return;
    const next = selected.includes(branch)
      ? selected.filter((b) => b !== branch)
      : [...selected, branch];
    void persistBranches(next);
  };

  const handleRemove = (branch) => {
    if (saving) return;
    void persistBranches(selected.filter((b) => b !== branch));
  };

  const handleAddTyped = (raw) => {
    if (saving) return;
    const additions = parseTypedBranches(raw);
    if (additions.length === 0) return;
    const next = mergeBranches(selected, additions);
    setQuery('');
    if (next.length !== selected.length) {
      void persistBranches(next);
    }
  };

  const handleClearAll = () => {
    if (saving || selected.length === 0) return;
    void persistBranches([]);
  };

  const repoBranchSet = new Set(repoBranches);
  const customSelected = selected.filter((b) => !repoBranchSet.has(b));
  const combinedBranches = [...customSelected, ...repoBranches];

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const filteredBranches = lowerQuery
    ? combinedBranches.filter((b) => b.toLowerCase().includes(lowerQuery))
    : combinedBranches;

  const parsedAdditions = parseTypedBranches(query);
  const hasNewTypedBranch = parsedAdditions.some((b) => !selected.includes(b));
  const showCustomAddRow =
    trimmedQuery.length > 0 && !combinedBranches.includes(trimmedQuery) && hasNewTypedBranch;

  const isRefreshing = loadingBranches || clearingCache;

  const renderEmptyState = () => {
    if (loadingBranches) {
      return (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          Loading branches…
        </div>
      );
    }
    if (showCustomAddRow) return null;
    if (trimmedQuery && selected.includes(trimmedQuery)) {
      return (
        <p className="px-3 py-2.5 text-xs text-faint">
          <code className="font-mono text-secondary">{trimmedQuery}</code> is already added.
        </p>
      );
    }
    return (
      <p className="px-3 py-2.5 text-xs text-faint">
        No branches found. Type a branch name and press Enter to add it.
      </p>
    );
  };

  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-fg-muted">Agent auto-push branches</span>
        <Tooltip content={HELP_TEXT} wrap wide placement="top">
          <button
            type="button"
            aria-label="About agent auto-push branches"
            className="text-faint hover:text-secondary focus:outline-none"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
        {saving && <span className="text-[11px] text-faint">Saving…</span>}
        {!saving && justSaved && <span className="text-[11px] text-success">Saved</span>}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {selected.map((branch) => (
          <span
            key={branch}
            className="inline-flex items-center gap-1 rounded-md border border-strong bg-control px-2 py-0.5 text-xs font-mono text-fg"
          >
            <GitBranch className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            <span className="max-w-[200px] truncate" title={branch}>
              {branch}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleRemove(branch)}
              aria-label={`Remove branch ${branch}`}
              className="ml-0.5 rounded p-0.5 text-faint hover:bg-control-hover hover:text-fg disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}

        <AnchoredMenu
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setQuery('');
          }}
          placement="bottom-start"
          className={`w-72 max-h-80 overflow-hidden flex flex-col ${DROPDOWN_PANEL_CLASS}`}
          reference={({ ref, referenceProps }) => (
            <button
              type="button"
              ref={ref}
              disabled={saving}
              aria-expanded={open}
              aria-haspopup="listbox"
              {...referenceProps}
              onClick={(e) => {
                referenceProps.onClick?.(e);
                setOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-strong bg-transparent px-2 py-0.5 text-xs text-fg-muted hover:border-faint hover:bg-control/60 hover:text-fg transition-colors disabled:opacity-50"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add branch
            </button>
          )}
        >
          <div className="flex items-center gap-1.5 border-b border-line px-2 py-2 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTyped(query);
                }
              }}
              placeholder="Search or type branch name…"
              aria-label="Search or type branch name"
              className="min-w-0 flex-1 rounded-md border border-strong bg-control px-2.5 py-1 text-xs font-mono text-fg placeholder:font-sans placeholder-faint focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand/50"
            />
            <button
              type="button"
              onClick={() => void clearCacheAndReload()}
              disabled={isRefreshing}
              title="Refresh branches"
              aria-label="Refresh branches"
              className="shrink-0 rounded-md p-1.5 text-faint hover:bg-control hover:text-fg transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                aria-hidden
              />
            </button>
          </div>

          <div
            role="listbox"
            aria-multiselectable="true"
            className="overflow-y-auto flex-1 min-h-0 py-1"
          >
            {showCustomAddRow && (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleAddTyped(query)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-accent hover:bg-control/60 transition-colors disabled:opacity-50"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate font-mono">Add &ldquo;{trimmedQuery}&rdquo;</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                  custom
                </span>
              </button>
            )}

            {filteredBranches.length === 0
              ? renderEmptyState()
              : filteredBranches.map((branch) => {
                  const isSelected = selected.includes(branch);
                  const badge = branchRowBadge(
                    branch,
                    repo?.default_branch,
                    repoBranchSet.has(branch)
                  );
                  return (
                    <button
                      key={branch}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={saving}
                      onClick={() => handleToggle(branch)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-control/60 disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                          {isSelected && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
                        </span>
                        <span
                          className={`truncate font-mono ${isSelected ? 'text-fg font-medium' : 'text-secondary'}`}
                          title={branch}
                        >
                          {branch}
                        </span>
                      </span>
                      {badge && (
                        <span className="shrink-0 rounded bg-control-hover px-1.5 py-0.5 text-[10px] text-faint">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11px] text-faint shrink-0">
            <span>
              {selected.length === 0
                ? 'Press Enter to add any branch'
                : `${selected.length} configured`}
            </span>
            {selected.length > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={handleClearAll}
                className="text-faint hover:text-danger transition-colors disabled:opacity-50"
              >
                Clear all
              </button>
            )}
          </div>
        </AnchoredMenu>
      </div>
    </div>
  );
}
