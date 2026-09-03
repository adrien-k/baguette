import { useState, useEffect, useRef, useMemo } from 'react';
import GithubIcon from './GithubIcon.jsx';
import { apiFetch } from '../api.js';
import { pluginsService, recentCombosService } from '../feathers.js';
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

// "Claude / modelId" or "Cursor / modelId", with params appended only when showParams is true
function comboLabel(agentSdk, model, showParams = false, params = null) {
  const sdkLabel = agentSdk === 'cursor' ? 'Cursor' : 'Claude';
  if (!model) return sdkLabel;
  const base = `${sdkLabel} / ${model}`;
  if (showParams && params) {
    const rawParams = typeof params === 'string' ? JSON.parse(params) : params;
    if (rawParams?.length) {
      return `${base} (${rawParams.map((p) => `${p.id}:${p.value}`).join(', ')})`;
    }
  }
  return base;
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
  const [model, setModel] = useState('');
  const [cursorVariantIdx, setCursorVariantIdx] = useState(null);
  const [models, setModels] = useState([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = persistentState.useState('plugins', []);
  const [availablePlugins, setAvailablePlugins] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [recentCombos, setRecentCombos] = useState([]);
  const initialPromptRef = useRef(null);
  const isCursor = agentSdk === 'cursor';

  // Cascade-clear harness change: reset model + variant
  const setAgentSdk = (sdk) => {
    setAgentSdkRaw(sdk);
    setModel('');
    setCursorVariantIdx(null);
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
    const base =
      agentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    const url = force && agentSdk !== 'cursor' ? '/api/settings/models/refresh' : base;
    const method = force && agentSdk !== 'cursor' ? 'POST' : 'GET';
    setRefreshingModels(true);
    return apiFetch(url, method === 'POST' ? { method } : undefined)
      .then((d) => setModels(d.models || []))
      .catch(() => {})
      .finally(() => setRefreshingModels(false));
  };

  // Load models for current harness whenever agentSdk changes
  useEffect(() => {
    setModels([]);
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSdk]);

  // Set default model only when model is explicitly empty (e.g. after harness cascade-clear)
  useEffect(() => {
    setModel((prev) => {
      if (prev !== '') return prev; // keep whatever is set — combo or user choice
      return models[0]?.id || '';
    });
  }, [agentSdk, models]);

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

  // Load recent combos for this repo and immediately apply the latest one
  useEffect(() => {
    if (!repoFullName) { setRecentCombos([]); return; }
    recentCombosService
      .find({ query: { repoFullName } })
      .then((combos) => {
        setRecentCombos(combos);
        if (combos.length > 0) {
          const combo = combos[0];
          setAgentSdkRaw(combo.agentSdk);
          setModel(combo.model);
          setCursorVariantIdx(combo.variantId ?? null);
        }
      })
      .catch(() => setRecentCombos([]));
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
    const modelPayload = (() => {
      if (!model) return undefined;
      if (isCursor && selectedVariant?.params?.length) {
        return JSON.stringify({ id: model, params: selectedVariant.params });
      }
      return model;
    })();
    return {
      repoFullName,
      branch,
      initialPrompt,
      files,
      permissionMode: 'bypassPermissions',
      planMode,
      model: modelPayload,
      createNewBranch,
      branchName: branchName || undefined,
      autoPush,
      plugins: selectedPlugins.length > 0 ? selectedPlugins : undefined,
      agentSdk,
      variantId: cursorVariantIdx,
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

  const comboMatchIdx = recentCombos.findIndex(
    (c) => c.agentSdk === agentSdk && c.model === model && c.variantId === cursorVariantIdx
  );

  const handleComboChange = (e) => {
    const val = e.target.value;
    if (val === '__custom__') {
      setShowMore(true);
      return;
    }
    const idx = parseInt(val, 10);
    if (isNaN(idx)) return;
    const combo = recentCombos[idx];
    if (!combo) return;
    setAgentSdkRaw(combo.agentSdk);
    setModel(combo.model);
    setCursorVariantIdx(combo.variantId ?? null);
  };

  const handleDeleteCombo = (id) => {
    recentCombosService
      .remove(id)
      .then(() => setRecentCombos((prev) => prev.filter((c) => c.id !== id)))
      .catch((err) => toastError('Failed to remove combo', err));
  };

  const comboSelectValue = comboMatchIdx >= 0 ? String(comboMatchIdx) : '__custom__';

  const { owner: repoOwner, name: repoName } = parseRepoFullName(repoFullName);

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
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Harness</label>
              <select
                value={agentSdk}
                onChange={(e) => setAgentSdk(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="claude">Claude</option>
                <option value="cursor">Cursor</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-zinc-300">Model</label>
                <button
                  type="button"
                  onClick={() => loadModels(true)}
                  disabled={refreshingModels}
                  className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
                >
                  {refreshingModels ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </div>
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); setCursorVariantIdx(null); }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                {models.length === 0 && <option value="">Loading…</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            {isCursor && (() => {
              const selectedModel = models.find((m) => m.id === model);
              const variants = selectedModel?.variants ?? [];
              return variants.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Variant</label>
                  <select
                    value={cursorVariantIdx ?? 0}
                    onChange={(e) => setCursorVariantIdx(parseInt(e.target.value))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    {variants.map((v, i) => (
                      <option key={i} value={i}>
                        {variantLabel(v, selectedModel?.display_name)}
                        {v.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null;
            })()}

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
      <div className="flex flex-wrap items-center gap-3">
        {recentCombos.length > 0 && (() => {
          // Compute base labels for duplicate detection
          const baseLabels = recentCombos.map((c) => comboLabel(c.agentSdk, c.model, false));
          const baseLabelCount = {};
          baseLabels.forEach((l) => { baseLabelCount[l] = (baseLabelCount[l] || 0) + 1; });

          return (
            <div className="flex items-center gap-1">
              <select
                value={comboSelectValue}
                onChange={handleComboChange}
                disabled={!repoFullName}
                className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-40 min-w-0 max-w-xs truncate"
              >
                <option value="__custom__">Custom</option>
                {recentCombos.map((combo, i) => {
                  const showParams = baseLabelCount[baseLabels[i]] > 1;
                  return (
                    <option key={i} value={String(i)}>
                      {comboLabel(combo.agentSdk, combo.model, showParams, combo.params)}
                    </option>
                  );
                })}
              </select>
              {comboMatchIdx >= 0 && (
                <button
                  type="button"
                  onClick={() => handleDeleteCombo(recentCombos[comboMatchIdx].id)}
                  title="Remove from recents"
                  className="px-1.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors text-base leading-none"
                >
                  ×
                </button>
              )}
            </div>
          );
        })()}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
          >
            {loading ? 'Creating...' : 'Start'}
          </button>
          <button
            type="button"
            onClick={handlePlan}
            disabled={!canSubmit}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 hover:text-white px-5 py-2.5 rounded-md text-sm font-medium transition-colors border border-zinc-700 disabled:border-zinc-700"
          >
            Plan
          </button>
        </div>
      </div>
    </form>
  );
}
