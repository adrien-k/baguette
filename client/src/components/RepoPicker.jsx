import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Plus, Layers, Bot } from 'lucide-react';
import GithubIcon from './svg/GithubIcon.jsx';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import {
  repoDisplayName,
  isLocalRepo,
  groupReposByOrg,
  repoOrg,
} from '../utils/repoDisplayName.js';

export default function RepoPicker({
  className = '',
  includeAllSessions = true,
  includeManage = true,
  navigateOnSelect = true,
  syncContext = true,
  showOrgInLabel = false,
  fullWidth = false,
  value,
  onChange,
}) {
  const { repos, selectedRepo, setSelectedRepo } = useRepoContext();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const orgGroups = useMemo(() => groupReposByOrg(repos), [repos]);

  const current = value !== undefined ? value : selectedRepo;
  const isAllSessions = current === ALL_REPOS;
  const isGlobal = current === GLOBAL_SCOPE;
  const label = isAllSessions
    ? 'All sessions'
    : isGlobal
      ? 'Global'
      : current
        ? showOrgInLabel
          ? `${repoOrg(current)} / ${repoDisplayName(current)}`
          : repoDisplayName(current)
        : 'Select repo';

  const select = (next, path) => {
    onChange?.(next);
    if (syncContext) setSelectedRepo(next);
    if (navigateOnSelect && path) navigate(path);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 hover:text-white shadow-sm ${
          fullWidth ? 'w-full' : ''
        }`}
      >
        {isAllSessions ? (
          <Layers className="w-4 h-4 shrink-0" />
        ) : isGlobal ? (
          <Bot className="w-4 h-4 shrink-0" />
        ) : (
          <GithubIcon className="w-4 h-4 shrink-0" />
        )}
        <span className={fullWidth ? 'flex-1 truncate text-left' : 'max-w-32 truncate'}>
          {label}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div
          className={`absolute left-0 top-full mt-1 max-h-[min(24rem,70vh)] overflow-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1 ${
            fullWidth ? 'w-full min-w-64' : 'w-64'
          }`}
        >
          {includeAllSessions && (
            <>
              <button
                type="button"
                onClick={() => select(ALL_REPOS, '/')}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  isAllSessions
                    ? 'text-white bg-zinc-800'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                All sessions
              </button>
              <div className="border-t border-zinc-700 my-1" />
            </>
          )}
          <button
            type="button"
            onClick={() => select(GLOBAL_SCOPE, '/global')}
            className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isGlobal
                ? 'text-white bg-zinc-800'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
            }`}
          >
            <Bot className="w-3.5 h-3.5 shrink-0" />
            Global
          </button>
          {orgGroups.map((group) => (
            <div key={group.org}>
              <div className="border-t border-zinc-700 my-1" />
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                {group.org}
              </div>
              {group.repos.map((r) => (
                <button
                  type="button"
                  key={r.full_name}
                  onClick={() => select(r.full_name, `/repos/${r.id}`)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    current === r.full_name
                      ? 'text-white bg-zinc-800'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                  }`}
                >
                  <GithubIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{repoDisplayName(r.full_name)}</span>
                  {isLocalRepo(r.full_name) && (
                    <span className="ml-1.5 text-xs text-zinc-500">local</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {includeManage && (
            <div className="border-t border-zinc-700 mt-1 pt-1">
              <Link
                to="/settings?tab=repos"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Manage repositories
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
