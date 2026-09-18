import { useState, useEffect } from 'react';
import { X, Upload, Pencil, AlertTriangle } from 'lucide-react';
import SearchableSelect from './SearchableSelect/index.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { sessionsService } from '../feathers.js';

export default function PushConfirmModal({
  sessionId,
  repo,
  commitsToPush,
  initialBranch,
  initialForceMode,
  onConfirm,
  onCancel,
  onEditDetails,
}) {
  const [forceMode, setForceMode] = useState(initialForceMode || '');
  const [branch, setBranch] = useState(initialBranch || '');
  const [localSha, setLocalSha] = useState(null);
  const [remoteSha, setRemoteSha] = useState(null);
  const [loadingShas, setLoadingShas] = useState(false);

  const { branches, loading: loadingBranches } = useGetBranches(repo);

  const isPureForce = forceMode === 'force';

  useEffect(() => {
    if (!sessionId || !branch) {
      setLocalSha(null);
      setRemoteSha(null);
      return;
    }
    let cancelled = false;
    setLoadingShas(true);
    sessionsService
      .shas({ id: sessionId, branch })
      .then((res) => {
        if (cancelled) return;
        setLocalSha(res.localSha ?? null);
        setRemoteSha(res.remoteSha ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setLocalSha(null);
          setRemoteSha(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingShas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, branch]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-white font-semibold">Push commits</h3>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 p-1 -m-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-zinc-400 text-sm mb-1">
          Push{' '}
          {commitsToPush > 0 ? (
            <span className="text-amber-400 font-medium">
              {commitsToPush} commit{commitsToPush !== 1 ? 's' : ''}
            </span>
          ) : (
            'changes'
          )}{' '}
          to GitHub and create/update the PR.
        </p>
        <p className="text-zinc-500 text-xs mb-4">
          Would you like to review the PR title and description before pushing?
        </p>

        <div className="flex flex-col gap-3 mb-6">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Branch</label>
            <SearchableSelect
              value={branch}
              onChange={setBranch}
              options={branches}
              loading={loadingBranches}
              placeholder="Search branches..."
              loadingText="Loading branches..."
              emptyText="No branches found"
            />
            {(localSha || remoteSha) && (
              <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
                <span title="Local HEAD">{localSha ?? '?'}</span>
                <span className="text-zinc-700">/</span>
                <span
                  title={`origin/${branch}`}
                  className={
                    remoteSha && remoteSha !== localSha ? 'text-zinc-400' : 'text-zinc-600'
                  }
                >
                  {loadingShas ? '…' : (remoteSha ?? 'no remote')}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Force mode</label>
            <select
              value={forceMode}
              onChange={(e) => setForceMode(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="">Normal push</option>
              <option value="lease">Force with lease (--force-with-lease)</option>
              <option value="force">Force (--force)</option>
            </select>
          </div>

          {isPureForce && (
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>--force</strong> overwrites remote history. Only use if you know what
                you&apos;re doing.
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onEditDetails}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            Review PR details first
          </button>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm({ forceMode: forceMode || null, branch: branch || null })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                isPureForce
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              {isPureForce ? 'Force Push' : forceMode === 'lease' ? 'Force Push' : 'Push'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
