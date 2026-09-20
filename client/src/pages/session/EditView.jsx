import { useState, useEffect } from 'react';
import { ExternalLink, Save, RefreshCw, Globe, Wifi } from 'lucide-react';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import toast from 'react-hot-toast';

export default function EditView({ session }) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [dirty, setDirty] = useState(false);

  const sessionId = session?.id;
  useEffect(() => {
    if (!session) return;
    setLabel(session.label ?? '');
    setDescription(session.pr_description ?? '');
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleSave = async () => {
    if (!session?.id || saving) return;
    setSaving(true);
    try {
      await sessionsService.patch(session.id, {
        label: label || null,
        pr_description: description || null,
      });
      setDirty(false);
      toast.success('Saved');
    } catch (err) {
      toastError('Failed to save', err);
    } finally {
      setSaving(false);
    }
  };

  const handleFetchFromPr = async () => {
    if (!session?.id || fetching) return;
    setFetching(true);
    try {
      const pr = await sessionsService.getPrDetails(session.id);
      setLabel(pr.title);
      setDescription(pr.body);
      setDirty(true);
    } catch (err) {
      toastError('Failed to fetch PR details', err);
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto min-h-0 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-300 mb-1">Session / PR Details</h2>
            <p className="text-xs text-zinc-500">
              The agent keeps these in sync as work progresses. You can also edit them manually.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {session?.pr_url && (
              <>
                <button
                  type="button"
                  onClick={handleFetchFromPr}
                  disabled={fetching}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  title="Load current title and description from GitHub PR"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${fetching ? 'animate-spin' : ''}`} />
                  {fetching ? 'Fetching…' : 'Fetch from PR'}
                </button>
                <a
                  href={session.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  PR #{session.pr_number}
                </a>
              </>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-400">Title</label>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setDirty(true);
            }}
            placeholder="Session title / PR title"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            placeholder="PR description (markdown supported)"
            rows={12}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-y font-mono"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500 rounded-lg text-sm text-white font-medium transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          {dirty && <span className="text-xs text-zinc-500">Unsaved changes</span>}
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500">
            Changes are pushed to GitHub when you use the{' '}
            <span className="text-zinc-400 font-medium">Push</span> button or when auto-push runs.
          </p>
        </div>

        {session?.preview_url && (
          <div className="border-t border-zinc-800 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-zinc-400" />
                <div>
                  <h3 className="text-sm font-medium text-zinc-300">Public preview</h3>
                  <p className="text-xs text-zinc-500">
                    Anyone with the link can open the preview and start the dev server.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!session?.is_preview_public}
                onClick={() => {
                  if (!session?.id) return;
                  sessionsService
                    .patch(session.id, { is_preview_public: !session.is_preview_public })
                    .catch((err) => toastError('Failed to update public preview setting', err));
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${session?.is_preview_public ? 'bg-amber-500' : 'bg-zinc-600'}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${session?.is_preview_public ? 'translate-x-4.5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-zinc-400" />
                <div>
                  <h3 className="text-sm font-medium text-zinc-300">IP-public preview</h3>
                  <p className="text-xs text-zinc-500">
                    Sign in to start the dev server; once running, the same IP can use the preview
                    without signing in.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!session?.is_preview_ip_public}
                onClick={() => {
                  if (!session?.id) return;
                  sessionsService
                    .patch(session.id, { is_preview_ip_public: !session.is_preview_ip_public })
                    .catch((err) => toastError('Failed to update IP-public preview setting', err));
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${session?.is_preview_ip_public ? 'bg-amber-500' : 'bg-zinc-600'}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${session?.is_preview_ip_public ? 'translate-x-4.5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
