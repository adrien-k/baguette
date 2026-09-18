import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Plus, Layers } from 'lucide-react';
import GithubIcon from './GithubIcon.jsx';
import { useRepoContext, ALL_REPOS } from '../context/RepoContext.jsx';
import { repoDisplayName, isLocalRepo } from '../utils/repoDisplayName.js';

export default function RepoPicker({ className = '' }) {
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

  const isAllSessions = selectedRepo === ALL_REPOS;
  const label = isAllSessions
    ? 'All sessions'
    : selectedRepo
      ? repoDisplayName(selectedRepo)
      : 'Select repo';

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 hover:text-white shadow-sm"
      >
        {isAllSessions ? (
          <Layers className="w-4 h-4 shrink-0" />
        ) : (
          <GithubIcon className="w-4 h-4 shrink-0" />
        )}
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          <button
            onClick={() => {
              setSelectedRepo(ALL_REPOS);
              navigate('/');
              setOpen(false);
            }}
            className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isAllSessions
                ? 'text-white bg-zinc-800'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            All sessions
          </button>
          {repos.length > 0 && <div className="border-t border-zinc-700 my-1" />}
          {repos.map((r) => (
            <Link
              key={r.full_name}
              to={`/repos/${r.id}`}
              onClick={() => {
                setSelectedRepo(r.full_name);
                setOpen(false);
              }}
              className={`block px-3 py-2 text-sm transition-colors ${
                selectedRepo === r.full_name
                  ? 'text-white bg-zinc-800'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              {repoDisplayName(r.full_name)}
              {isLocalRepo(r.full_name) && (
                <span className="ml-1.5 text-xs text-zinc-500">local</span>
              )}
            </Link>
          ))}
          <div className={repos.length > 0 ? 'border-t border-zinc-700 mt-1 pt-1' : ''}>
            <Link
              to="/settings?tab=repos"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Manage repositories
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
