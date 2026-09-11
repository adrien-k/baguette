import { useState, useEffect, useRef, useMemo } from 'react';
import GithubIcon from './GithubIcon.jsx';
import { apiFetch } from '../api.js';
import { sessionsService, pluginsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import FileAttachmentPicker from './FileAttachmentPicker.jsx';
import SearchableSelect from './SearchableSelect';
import { isMobile } from '../utils/isMobile.js';
import { variantLabel } from '../utils/models.js';

function parseRepoFullName(full) {
  if (!full) return { owner: '', name: '' };
  const i = full.indexOf('/');
  if (i === -1) return { owner: full, name: '' };
  return { owner: full.slice(0, i), name: full.slice(i + 1) };
}

export default function BuilderForm({ onSubmit, loading, repoFullName, defaultPrompt }) {
  const persistentState = usePersistentState(`builder-form-${repoFullName}`);
  const globalState = usePersistentState('builder-form-global');
  const [branch, setBranch] = persistentState.useState('branch', '');
  const [initialPrompt, setInitialPrompt] = persistentState.useState('prompt', defaultPrompt || '');
  const [showMore, setShowMore] = globalState.useState('showMore', false);
  const [createNewBranch, setCreateNewBranch] = persistentState.useState('createNewBranch', true);
  const [branchName, setBranchName] = persistentState.useState('branchName', '');
  const [autoPush, setAutoPush] = persistentState.useState('autoPush', true);
  const { repos } = useRepoContext();
  const [agentSdk, setAgentSdkRaw] = persistentState.useState('agentSdk', 'claude');
  const [model, setModel] = persistentState.useState('model', '');
  const [cursorVariantIdx, setCursorVariantIdx] = useState(null);
  const [variantExpanded, setVariantExpanded] = useState(false);
  const [models, setModels] = useState([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = persistentState.useState('plugins', []);
  const [availablePlugins, setAvailablePlugins] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const initialPromptRef = useRef(null);
  // Holds model_params string from the last session, used to seed cursorVariantIdx on model load
  const pendingModelParamsRef = useRef(null);
  const isCursor = agentSdk === 'cursor';

  // Cascade-clear harness change: reset model + variant
  const setAgentSdk = (sdk) => {
    setAgentSdkRaw(sdk);
    setModel('');
    setCursorVariantIdx(null);
    setVariantExpanded(false);
  };

  const selectedRepo = useMemo(
    () => repos.find((r) => r.full_name === repoFullName),
    [repos, repoFullName]
  );
  const {
    branches,
    loading: loadingBranches,
    clearCacheAndReload,
    clearingCache,
  } = useGetBranches(selectedRepo);

  // Auto-select default branch when repo changes
  useEffect(() => {
    if (!repoFullName) {
      setBranch('');
      return;
    }
    if (loadingBranches) return;
    if (branch && branches.includes(branch)) return;
    const defaultBranch = selectedRepo?.default_branch || branches[0];
    if (defaultBranch) setBranch(defaultBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, selectedRepo?.default_branch, branches]);

  const loadModels = (force = false) => {
    const refreshUrl =
      agentSdk === 'cursor'
        ? '/api/settings/models/refresh?sdk=cursor'
        : '/api/settings/models/refresh';
    const getUrl =
      agentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    const url = force ? refreshUrl : getUrl;
    setRefreshingModels(true);
    return apiFetch(url, force ? { method: 'POST' } : undefined)
      .then((d) => setModels(d.models || []))
      .catch((err) => { if (force) toastError('Failed to refresh models', err); })
      .finally(() => setRefreshingModels(false));
  };

  // Load models for current harness whenever agentSdk changes
  useEffect(() => {
    setModels([]);
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSdk]);

  // Validate/default model when models load; also resolve pendingModelParams variant
  useEffect(() => {
    if (!models.length) return;

    // Ensure model is valid; fall back to first
    setModel((prev) => {
      if (prev && models.some((m) => m.id === prev)) return prev;
      return models[0]?.id || '';
    });

    // Resolve pending model_params to a variant index (from last session load)
    const pending = pendingModelParamsRef.current;
    if (isCursor && pending) {
      setModel((currentModel) => {
        const selectedModel = models.find((m) => m.id === currentModel);
        const variants = selectedModel?.variants ?? [];
        const idx = variants.findIndex((v) => {
          try { return JSON.stringify(v.params) === pending; } catch { return false; }
        });
        if (idx >= 0) setCursorVariantIdx(idx);
        return currentModel;
      });
      pendingModelParamsRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // Set default cursor variant when model or models change (only if not already set)
  useEffect(() => {
    if (!isCursor) { setCursorVariantIdx(null); return; }
    const m = models.find((m) => m.id === model);
    const variants = m?.variants ?? [];
    if (variants.length === 0) { setCursorVariantIdx(null); return; }
    setCursorVariantIdx((prev) => {
      if (prev != null && prev < variants.length) return prev;
      const defaultIdx = variants.findIndex((v) => v.is_default);
      return defaultIdx >= 0 ? defaultIdx : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, models]);

  // Populate form from the most recent session for this repo
  useEffect(() => {
    if (!repoFullName) return;
    sessionsService
      .find({ query: { repo_full_name: repoFullName, $limit: 5 } })
      .then((result) => {
        const sessions = (result.data || []).filter((s) => s.agent_sdk || s.model);
        if (!sessions.length) return;
        const last = sessions[0];
        if (last.agent_sdk) setAgentSdkRaw(last.agent_sdk);
        if (last.model) setModel(last.model);
        pendingModelParamsRef.current = last.model_params || null;
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName]);

  useEffect(() => {
    pluginsService
      .find()
      .then((d) => setAvailablePlugins(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const canSubmit = !loading && repoFullName && branch && initialPrompt;

  useEffect(() => {
    if (!initialPromptRef.current) return;
    const el = initialPromptRef.current;
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight);
    el.style.height = Math.min(el.scrollHeight, lineHeight * 20) + 'px';
  }, [initialPrompt]);

  const clearForm = () => {
    persistentState.clear();
    setFiles([]);
    setFileError(null);
  };

  const buildPayload = ({ planMode }) => {
    const selectedModel = isCursor ? models.find((m) => m.id === model) : null;
    const selectedVariant =
      selectedModel?.variants != null && cursorVariantIdx != null
        ? selectedModel.variants[cursorVariantIdx]
        : null;
    return {
      repoFullName,
      branch,
      initialPrompt,
      files,
      permissionMode: 'bypassPermissions',
      planMode,
      model: model || undefined,
      modelParams:
        isCursor && selectedVariant?.params?.length
          ? JSON.stringify(selectedVariant.params)
          : undefined,
      createNewBranch,
      branchName: branchName || undefined,
      autoPush,
      plugins: selectedPlugins.length > 0 ? selectedPlugins : undefined,
      agentSdk,
    };
  };

  const handleStart = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: false }))) clearForm();
  };

  const handlePlan = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: true }))) clearForm();
  };

  const handleKeyDown = async (e) => {
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit && (await onSubmit(buildPayload({ planMode: false })))) clearForm();
    }
  };

  const handleAddFiles = (picked) => {
    setFileError(null);
    setFiles((prev) => [...prev, ...picked]);
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const { owner: repoOwner, name: repoName } = parseRepoFullName(repoFullName);

  const selectedModel = isCursor ? models.find((m) => m.id === model) : null;
  const selectedVariant =
    selectedModel?.variants != null && cursorVariantIdx != null
      ? selectedModel.variants[cursorVariantIdx]
      : null;
  const variants = selectedModel?.variants ?? [];

  return (
    <form onSubmit={handleStart} className="space-y-4">
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-300">Base branch</label>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect
                value={branch}
                onChange={setBranch}
                options={branches}
                loading={loadingBranches}
                disabled={!repoFullName}
                placeholder="Search branches..."
                loadingText="Loading branches..."
                emptyText="No branches found"
                disabledText="Select a repository first"
              />
            </div>
            <button
              type="button"
              onClick={() => clearCacheAndReload()}
              disabled={!repoFullName || loadingBranches || clearingCache}
              title="Clear cache and reload branches"
              className="shrink-0 self-start px-1 py-2.5 text-sm leading-none text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
            >
              ↺
            </button>
          </div>
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
          <GithubIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
          {repoFullName ? (
            <span className="min-w-0 truncate">
              <span className="text-zinc-500">{repoOwner}</span>
              <span className="text-zinc-600"> / </span>
              <span className="text-zinc-400">{repoName}</span>
            </span>
          ) : (
            <span className="text-zinc-600">No repository selected</span>
          )}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">Initial Prompt</label>
        <FileAttachmentPicker
          files={files}
          onAdd={handleAddFiles}
          onRemove={handleRemoveFile}
          error={fileError}
        >
          <textarea
            ref={initialPromptRef}
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 pr-9 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent overflow-y-auto resize-none"
            placeholder="Describe what you want the agent to do..."
            required
          />
        </FileAttachmentPicker>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showMore ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          More options
        </button>

        {showMore && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3">
            {createNewBranch && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Branch name{' '}
                  <span className="text-zinc-500 font-normal">(optional, auto-generated if empty)</span>
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="my-feature-branch"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent"
                />
              </div>
            )}

            {availablePlugins.length > 0 && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Plugins</label>
                <div className="space-y-1.5">
                  {availablePlugins.map((plugin) => (
                    <label
                      key={plugin.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPlugins.includes(plugin.id)}
                        onChange={(e) =>
                          setSelectedPlugins((prev) =>
                            e.target.checked
                              ? [...prev, plugin.id]
                              : prev.filter((id) => id !== plugin.id)
                          )
                        }
                        className="mt-0.5 rounded border-zinc-600 text-amber-500 focus:ring-amber-500/50"
                      />
                      <span className="text-sm text-zinc-300 leading-tight">
                        <span className="font-medium text-zinc-200">{plugin.name}</span>
                        <span className="block text-xs font-normal text-zinc-500 mt-0.5">
                          {plugin.marketplace_repo} · {plugin.plugin_path}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={createNewBranch}
          onClick={() => setCreateNewBranch((v) => !v)}
          className="flex items-center gap-2 group"
        >
          <span
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${createNewBranch ? 'bg-amber-500' : 'bg-zinc-600'}`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${createNewBranch ? 'translate-x-3.5' : 'translate-x-0.5'}`}
            />
          </span>
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
            New branch
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={autoPush}
          onClick={() => setAutoPush((v) => !v)}
          className="flex items-center gap-2 group"
        >
          <span
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${autoPush ? 'bg-amber-500' : 'bg-zinc-600'}`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${autoPush ? 'translate-x-3.5' : 'translate-x-0.5'}`}
            />
          </span>
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
            Auto-push
          </span>
        </button>
      </div>

      {/* SDK + Model + (variant) on the left; Start/Plan on the right */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        {/* Left: selects + variant link */}
        <div>
          <div className="flex items-center gap-2">
            <select
              value={agentSdk}
              onChange={(e) => setAgentSdk(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="claude">Claude</option>
              <option value="cursor">Cursor</option>
            </select>

            <div className="flex items-center gap-1">
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); setCursorVariantIdx(null); setVariantExpanded(false); }}
                className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                {models.length === 0 && <option value="">Loading…</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadModels(true)}
                disabled={refreshingModels}
                title="Refresh models"
                className="px-1.5 py-2 text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors"
              >
                ↻
              </button>
            </div>
          </div>

          {/* Cursor variant link — tight margin below selects */}
          {isCursor && variants.length > 0 && (
            <div className="mt-1 ml-px">
              <button
                type="button"
                onClick={() => setVariantExpanded((v) => !v)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <span>
                  {selectedVariant
                    ? variantLabel(selectedVariant, selectedModel?.display_name)
                    : 'Select variant'}
                </span>
                <svg
                  className={`w-2.5 h-2.5 transition-transform ${variantExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {variantExpanded && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {variants.map((v, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setCursorVariantIdx(i); setVariantExpanded(false); }}
                      className={`px-2.5 py-1 rounded text-xs transition-colors border ${
                        cursorVariantIdx === i
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                      }`}
                    >
                      {variantLabel(v, selectedModel?.display_name)}
                      {v.is_default && <span className="ml-1 text-zinc-500">(default)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Start / Plan */}
        <div className="flex items-center gap-3 sm:ml-auto">
          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-5 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {loading ? 'Creating...' : 'Start'}
          </button>
          <button
            type="button"
            onClick={handlePlan}
            disabled={!canSubmit}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 hover:text-white px-5 py-2 rounded-md text-sm font-medium transition-colors border border-zinc-700 disabled:border-zinc-700"
          >
            Plan
          </button>
        </div>
      </div>
    </form>
  );
}
