import { ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import { usersService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { usePersistentState } from '../hooks/usePersistentState.js';
import SearchableSelect from './SearchableSelect';

export default function ReviewerForm({ repoFullName, onSubmit, loading }) {
  const { user } = useAuth();
  const persistentState = usePersistentState('reviewer-form');
  const [prNumber, setPrNumber] = persistentState.useState('prNumber', '');
  const [model, setModel] = persistentState.useState('model', '');
  const [extraInstructions, setExtraInstructions] = persistentState.useState('instructions', '');
  const [showMore, setShowMore] = persistentState.useState('showMore', false);
  const [openPRs, setOpenPRs] = useState([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [models, setModels] = useState([]);

  useEffect(() => {
    if (!repoFullName) {
      setOpenPRs([]);
      return;
    }
    setLoadingPRs(true);
    apiFetch(`/api/repos/${encodeURIComponent(repoFullName)}/prs`)
      .then((data) => setOpenPRs(Array.isArray(data) ? data : []))
      .catch((err) => {
        setOpenPRs([]);
        toastError('Failed to load pull requests', err);
      })
      .finally(() => setLoadingPRs(false));
  }, [repoFullName]);

  useEffect(() => {
    apiFetch('/api/settings/models')
      .then((d) => setModels(d.models || []))
      .catch(() => {});
    if (user?.id) {
      usersService
        .get(user.id)
        .then((d) => {
          if (d?.model) setModel((prev) => prev || d.model);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const canSubmit = !loading && repoFullName && prNumber;

  const handleStart = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const submitted = await onSubmit({
      repoFullName,
      prNumber: parseInt(prNumber, 10),
      model: model || undefined,
      extraInstructions: extraInstructions || undefined,
    });
    if (submitted) persistentState.clear();
  };

  return (
    <form onSubmit={handleStart} className="space-y-4">
      {/* PR selector */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">Pull Request</label>
        <SearchableSelect
          value={prNumber}
          onChange={setPrNumber}
          options={openPRs}
          loading={loadingPRs}
          disabled={!repoFullName}
          color="violet"
          placeholder="Search by title or PR number..."
          loadingText="Loading PRs..."
          emptyText="No open PRs"
          disabledText="Select a repository first"
          getOptionValue={(pr) => String(pr.number)}
          getOptionLabel={(pr) => `${pr.number} ${pr.title}`}
          renderOption={(pr) => (
            <>
              <span className="text-zinc-400 mr-1.5">#{pr.number}</span>
              <span className="text-white">{pr.title}</span>
              <span className="ml-2 text-xs text-zinc-500">{pr.user}</span>
            </>
          )}
          renderSelected={(pr) => (
            <>
              <span className="text-zinc-400 mr-1.5">#{pr.number}</span>
              {pr.title}
            </>
          )}
        />
      </div>

      {/* Extra instructions */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Additional Instructions <span className="text-zinc-500 font-normal">(optional)</span>
        </label>
        <textarea
          value={extraInstructions}
          onChange={(e) => setExtraInstructions(e.target.value)}
          rows={2}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent resize-none"
          placeholder="Focus on security, performance, specific areas..."
        />
      </div>

      {/* More options */}
      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showMore ? 'rotate-90' : ''}`} />
          More options
        </button>

        {showMore && (
          <div className="mt-3 max-w-xs">
            <label className="block text-sm font-medium text-zinc-300 mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
      >
        {loading ? 'Creating...' : 'Start Review'}
      </button>
    </form>
  );
}
