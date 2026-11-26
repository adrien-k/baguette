import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';
import { splitRepoPath, diffFileDisplayPath } from '../../utils/paths.js';
import { buildFilesPanelList, countFilesMatchingFilters } from '../../utils/fileFilters.js';

const SELECTED_FILE_BG = 'bg-brand/10';

function fileRowClass(selected) {
  return `w-full flex items-start justify-between gap-2 px-3 py-2 text-left transition-colors border-b border-line/50 ${
    selected ? SELECTED_FILE_BG : 'hover:bg-control'
  }`;
}

function filterInputClass(hasError) {
  const border = hasError
    ? 'border-danger focus:ring-danger/50'
    : 'border-strong focus:ring-brand/50';
  return `w-full font-mono text-xs bg-control border rounded-md px-2 py-1.5 text-heading placeholder-faint focus:outline-none focus:ring-1 ${border}`;
}

/** One regex input (include or exclude) with its inline validation hint. */
function RegexFilterField({ id, label, value, onChange, error, placeholder }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] uppercase tracking-wide text-faint mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? 'true' : undefined}
        className={filterInputClass(error)}
      />
      {error && <p className="mt-1 text-[10px] text-danger">{error}</p>}
    </div>
  );
}

function filterExcludedTextClass(selected) {
  if (selected) return 'text-secondary';
  return 'text-faint';
}

/** Scrollable file list, or empty when there are no changed files. */
function FilesList({ waitingForFiles, files, selectedFilePath, onSelectFile }) {
  if (waitingForFiles) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-8">
        <div className="w-5 h-5 border-2 border-strong border-t-secondary rounded-full animate-spin" />
      </div>
    );
  }
  if (files.length === 0) {
    return <p className="text-xs text-faint px-3 py-4">No files changed</p>;
  }
  return (
    <div className="flex-1 overflow-auto min-h-0">
      {files.map((file) => {
        const displayPath = diffFileDisplayPath(file);
        const { basename, dirname } = splitRepoPath(displayPath);
        const selected = Boolean(selectedFilePath && selectedFilePath === displayPath);
        const filterExcluded = Boolean(file.filterExcluded);
        const nameClass = filterExcluded ? filterExcludedTextClass(selected) : 'text-secondary';
        const dirnameClass = filterExcluded && !selected ? 'text-faint/70' : 'text-faint';
        const statsClass = filterExcluded && !selected ? 'opacity-50' : '';
        return (
          <button
            key={displayPath}
            type="button"
            onClick={() => onSelectFile?.(file)}
            className={fileRowClass(selected)}
            aria-current={selected ? 'true' : undefined}
          >
            <div className="min-w-0 flex-1">
              <span className={`font-mono text-xs truncate block ${nameClass}`}>{basename}</span>
              {dirname ? (
                <span className={`font-mono text-[10px] truncate block mt-0.5 ${dirnameClass}`}>
                  {dirname}
                </span>
              ) : null}
            </div>
            <div className={`flex shrink-0 items-center gap-1 pt-0.5 ${statsClass}`}>
              <span className="text-xs text-success">+{file.addedCount}</span>
              <span className="text-xs text-danger">-{file.removedCount}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function SessionFilesPanel({
  diffFiles,
  filesLoading,
  selectedFilePath = null,
  onSelectFile,
  onRefresh,
  unavailable,
  fileFilters = null,
}) {
  /** Start expanded when filters already apply (e.g. carried over from another session). */
  const [filtersExpanded, setFiltersExpanded] = useState(() =>
    Boolean(fileFilters?.includePattern || fileFilters?.excludePattern)
  );

  if (unavailable) {
    return <p className="text-xs text-faint px-3 py-4">Not available for global sessions.</p>;
  }

  const waitingForFiles = diffFiles === undefined;
  const compiled = fileFilters?.compiled ?? null;
  const filtersActive = Boolean(compiled?.active);
  const filtersDirty = Boolean(
    fileFilters && (fileFilters.includePattern || fileFilters.excludePattern)
  );
  const panelFiles = waitingForFiles ? [] : buildFilesPanelList(diffFiles, compiled);
  const totalCount = waitingForFiles ? 0 : diffFiles.length;
  const matchingCount = waitingForFiles ? 0 : countFilesMatchingFilters(diffFiles, compiled);
  const canClear = filtersDirty && typeof fileFilters?.clear === 'function';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 flex items-center justify-between border-b border-line/50 px-2 py-1.5">
        {fileFilters && (
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setFiltersExpanded((v) => !v)}
              aria-expanded={filtersExpanded}
              className="flex items-center gap-1 text-xs text-faint hover:text-secondary transition-colors p-1"
              title="Filter files with include/exclude regex"
            >
              {filtersExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              Filters
              {filtersActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
              )}
            </button>
            {canClear && (
              <button
                type="button"
                onClick={fileFilters.clear}
                className="flex items-center gap-1 text-xs text-faint hover:text-secondary transition-colors p-1"
                title="Clear file filters"
              >
                <X className="w-3 h-3" />
                Clear filters
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh || filesLoading}
          className="flex items-center gap-1.5 text-xs text-faint hover:text-secondary transition-colors disabled:opacity-40 p-1"
          title="Refresh files"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${filesLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {filtersExpanded && compiled && (
        <div className="shrink-0 border-b border-line/50 px-3 py-2 space-y-2">
          <RegexFilterField
            id="files-include-filter"
            label="Include"
            value={fileFilters.includePattern}
            onChange={fileFilters.setIncludePattern}
            error={compiled.includeError}
            placeholder="e.g. client/src|\.md$"
          />
          <RegexFilterField
            id="files-exclude-filter"
            label="Exclude"
            value={fileFilters.excludePattern}
            onChange={fileFilters.setExcludePattern}
            error={compiled.excludeError}
            placeholder="e.g. package-lock|\.snap$"
          />
          {filtersActive && (
            <p className="text-[10px] text-faint">
              Showing {matchingCount} of {totalCount} files
            </p>
          )}
        </div>
      )}

      <FilesList
        waitingForFiles={waitingForFiles}
        files={panelFiles}
        selectedFilePath={selectedFilePath}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}
