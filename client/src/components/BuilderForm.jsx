import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, HelpCircle, Repeat } from 'lucide-react';
import GithubIcon from './svg/GithubIcon.jsx';
import LoopScheduleFields from './LoopScheduleFields.jsx';
import Tooltip from './Tooltip.jsx';
import { scheduleFromLoop, schedulePayload, isScheduleComplete } from '../utils/loopSchedule.js';
import { apiFetch } from '../api.js';
import { sessionsService, pluginsService, usersService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { availableAgentSdks } from '@baguette/shared/agent-sdk-credentials.js';
import { toastError } from '../utils/toastError.jsx';
import { useRepoContext, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';
import FileAttachmentPicker from './FileAttachmentPicker.jsx';
import SearchableSelect from './SearchableSelect';
import RepoPicker from './RepoPicker.jsx';
import { isMobile } from '../utils/isMobile.js';
import { variantLabel, applyParamOverrides } from '../utils/models.js';

function parseRepoFullName(full) {
  if (!full) return { owner: '', name: '' };
  const i = full.indexOf('/');
  if (i === -1) return { owner: full, name: '' };
  return { owner: full.slice(0, i), name: full.slice(i + 1) };
}

export default function BuilderForm({
  onSubmit,
  onCreateLoop,
  onUpdateLoop,
  onCancelEdit,
  editingLoop,
  loading,
  repoFullName: repoFullNameProp,
  isGlobal: isGlobalProp = false,
  allowRepoChoice = false,
  defaultPrompt,
  defaultTargetScope,
}) {
  const persistKey = editingLoop
    ? null
    : allowRepoChoice
      ? 'builder-form-all'
      : `builder-form-${isGlobalProp ? 'global' : repoFullNameProp}`;
  const persistentState = usePersistentState(persistKey);
  const globalState = usePersistentState('builder-form-global');
  const { cursorFast, cursorEffort, setCursorFast, setCursorEffort } = useCursorModelPrefs();
  const defaultTarget = editingLoop
    ? editingLoop.is_global
      ? GLOBAL_SCOPE
      : editingLoop.repo_full_name
    : allowRepoChoice
      ? defaultTargetScope
      : isGlobalProp
        ? GLOBAL_SCOPE
        : repoFullNameProp;
  const [targetScope, setTargetScope] = persistentState.useState(
    'targetScope',
    defaultTarget || GLOBAL_SCOPE
  );
  const isGlobal = allowRepoChoice ? targetScope === GLOBAL_SCOPE : isGlobalProp;
  const repoFullName = allowRepoChoice ? (isGlobal ? null : targetScope) : repoFullNameProp;
  const [branch, setBranch] = persistentState.useState('branch', editingLoop?.base_branch ?? '');
  const [initialPrompt, setInitialPrompt] = persistentState.useState(
    'prompt',
    editingLoop?.prompt ?? defaultPrompt ?? ''
  );
  const [showMore, setShowMore] = globalState.useState('showMore', false);
  const [createNewBranch, setCreateNewBranch] = persistentState.useState('createNewBranch', true);
  const [branchName, setBranchName] = persistentState.useState('branchName', '');
  const [autoPush, setAutoPush] = persistentState.useState('autoPush', true);
  const { user } = useAuth();
  const { repos } = useRepoContext();
  const [userSettings, setUserSettings] = useState(null);
  const [agentSdk, setAgentSdkRaw] = persistentState.useState(
    'agentSdk',
    editingLoop?.agent_sdk ?? 'claude'
  );
  const [model, setModel] = persistentState.useState('model', editingLoop?.model ?? '');
  const [cursorVariantIdx, setCursorVariantIdx] = useState(null);
  const [variantExpanded, setVariantExpanded] = useState(false);
  const [prefsExpanded, setPrefsExpanded] = useState(false);
  const [models, setModels] = useState([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = persistentState.useState(
    'plugins',
    editingLoop?.plugins ?? []
  );
  const [availablePlugins, setAvailablePlugins] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  // 'session' starts one run now; 'loop' saves the same form as a recurring template.
  const [mode, setMode] = useState(editingLoop ? 'loop' : 'session');
  const [loopName, setLoopName] = useState(editingLoop?.name ?? '');
  const [singleSession, setSingleSession] = useState(!!editingLoop?.single_session);
  const [schedule, setSchedule] = useState(() => scheduleFromLoop(editingLoop));
  const initialPromptRef = useRef(null);
  // Holds model_params string from the last session (or the loop being edited), used to seed
  // cursorVariantIdx on model load
  const pendingModelParamsRef = useRef(editingLoop?.model_params ?? null);
  const isCursor = agentSdk === 'cursor';

  // Cascade-clear harness change: reset model + variant
  const setAgentSdk = (sdk) => {
    setAgentSdkRaw(sdk);
    setModel('');
    setCursorVariantIdx(null);
    setVariantExpanded(false);
    setPrefsExpanded(false);
  };

  const selectedRepo = useMemo(
    () => repos.find((r) => r.full_name === repoFullName),
    [repos, repoFullName]
  );

  const availableSdks = useMemo(
    () => (userSettings ? availableAgentSdks(userSettings, selectedRepo) : []),
    [userSettings, selectedRepo]
  );

  useEffect(() => {
    if (!user?.id) {
      setUserSettings(null);
      return;
    }
    usersService
      .get(user.id)
      .then((d) => setUserSettings(d))
      .catch(() => setUserSettings({}));
  }, [user?.id]);

  useEffect(() => {
    if (!availableSdks.length) return;
    if (!availableSdks.includes(agentSdk)) setAgentSdk(availableSdks[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setAgentSdk resets model state intentionally
  }, [availableSdks, agentSdk]);
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
      .catch((err) => {
        if (force) toastError('Failed to refresh models', err);
      })
      .finally(() => setRefreshingModels(false));
  };

  // Load models for current harness whenever agentSdk changes
  useEffect(() => {
    if (!availableSdks.includes(agentSdk)) return;
    setModels([]);
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSdk, availableSdks]);

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
        // Step A: find variant from last session, or model's default
        let latestOrDefaultVariantIdx = variants.findIndex((v) => {
          try {
            return JSON.stringify(v.params) === pending;
          } catch {
            return false;
          }
        });
        if (latestOrDefaultVariantIdx < 0) {
          const di = variants.findIndex((v) => v.is_default);
          latestOrDefaultVariantIdx = di >= 0 ? di : variants.length > 0 ? 0 : -1;
        }
        // Apply fast/effort overrides and find matching variant
        const latestOrDefaultVariant =
          latestOrDefaultVariantIdx >= 0 ? variants[latestOrDefaultVariantIdx] : null;
        if (latestOrDefaultVariant) {
          const mergedParams = applyParamOverrides(
            latestOrDefaultVariant.params || [],
            cursorFast,
            cursorEffort
          );
          const mergedStr = JSON.stringify(mergedParams);
          const withPreferenceVariantIdx = variants.findIndex((v) => {
            try {
              return JSON.stringify(v.params) === mergedStr;
            } catch {
              return false;
            }
          });
          setCursorVariantIdx(
            withPreferenceVariantIdx >= 0 ? withPreferenceVariantIdx : latestOrDefaultVariantIdx
          );
        } else {
          setCursorVariantIdx(null);
        }
        return currentModel;
      });
      pendingModelParamsRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // Set default cursor variant when model or models change (only if not already set)
  // Applies fast/effort overrides: finds latestOrDefault, then withPreference if a match exists
  useEffect(() => {
    if (!isCursor) {
      setCursorVariantIdx(null);
      return;
    }
    const m = models.find((m) => m.id === model);
    const variants = m?.variants ?? [];
    if (variants.length === 0) {
      setCursorVariantIdx(null);
      return;
    }
    setCursorVariantIdx((prev) => {
      if (prev != null && prev < variants.length) return prev;
      const defaultIdx = variants.findIndex((v) => v.is_default);
      const latestOrDefaultVariantIdx = defaultIdx >= 0 ? defaultIdx : 0;
      const latestOrDefaultVariant = variants[latestOrDefaultVariantIdx];
      if (latestOrDefaultVariant) {
        const mergedParams = applyParamOverrides(
          latestOrDefaultVariant.params || [],
          cursorFast,
          cursorEffort
        );
        const mergedStr = JSON.stringify(mergedParams);
        const withPreferenceVariantIdx = variants.findIndex((v) => {
          try {
            return JSON.stringify(v.params) === mergedStr;
          } catch {
            return false;
          }
        });
        return withPreferenceVariantIdx >= 0 ? withPreferenceVariantIdx : latestOrDefaultVariantIdx;
      }
      return latestOrDefaultVariantIdx;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, models]);

  // Populate form from the most recent session for this repo — but never over a loop being
  // edited, whose own harness and model are what should show.
  useEffect(() => {
    if (!repoFullName || isGlobal || editingLoop) return;
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

  const isLoop = mode === 'loop';
  // The branch-name field is the only other entry, and a loop never shows it.
  const hasMoreOptions = (!isGlobal && createNewBranch && !isLoop) || availablePlugins.length > 0;
  const canSubmit =
    !loading &&
    availableSdks.length > 0 &&
    (isGlobal || (repoFullName && branch)) &&
    initialPrompt &&
    (!isLoop || isScheduleComplete(schedule));

  useEffect(() => {
    if (!initialPromptRef.current) return;
    const el = initialPromptRef.current;
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight);
    el.style.height = Math.min(el.scrollHeight, lineHeight * 20) + 'px';
  }, [initialPrompt]);

  const clearForm = () => {
    const keepTarget = allowRepoChoice ? targetScope : null;
    persistentState.clear();
    if (keepTarget) setTargetScope(keepTarget);
    setFiles([]);
    setFileError(null);
    setLoopName('');
  };

  const buildPayload = ({ planMode }) => {
    const selectedModel = isCursor ? models.find((m) => m.id === model) : null;
    const selectedVariant =
      selectedModel?.variants != null && cursorVariantIdx != null
        ? selectedModel.variants[cursorVariantIdx]
        : null;
    const finalParams = isCursor
      ? applyParamOverrides(selectedVariant?.params ?? [], cursorFast, cursorEffort)
      : null;
    return {
      isGlobal,
      repoFullName,
      branch,
      initialPrompt,
      files,
      planMode,
      model: model || undefined,
      modelParams: isCursor && finalParams?.length ? JSON.stringify(finalParams) : undefined,
      createNewBranch,
      branchName: branchName || undefined,
      autoPush,
      plugins: selectedPlugins.length > 0 ? selectedPlugins : undefined,
      agentSdk,
    };
  };

  const handleStart = async () => {
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: false }))) clearForm();
  };

  const handlePlan = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: true }))) clearForm();
  };

  // A loop replays the same session on a schedule, so it saves the form as a template instead
  // of starting anything now. Attached files are per-run inputs and are not carried over.
  const buildLoopPayload = () => {
    const payload = buildPayload({ planMode: false });
    if (payload.isGlobal) {
      return {
        is_global: true,
        name: loopName.trim() || null,
        prompt: payload.initialPrompt,
        single_session: singleSession,
        create_new_branch: false,
        auto_push: false,
        agent_sdk: payload.agentSdk,
        model: payload.model ?? null,
        model_params: payload.modelParams ?? null,
        plugins: payload.plugins ?? [],
        ...schedulePayload(schedule),
      };
    }
    return {
      repo_full_name: payload.repoFullName,
      base_branch: payload.branch,
      name: loopName.trim() || null,
      prompt: payload.initialPrompt,
      single_session: singleSession,
      // Every run needs its own branch pushed somewhere reviewable, so neither is optional.
      create_new_branch: true,
      auto_push: true,
      agent_sdk: payload.agentSdk,
      model: payload.model ?? null,
      model_params: payload.modelParams ?? null,
      plugins: payload.plugins ?? [],
      ...schedulePayload(schedule),
    };
  };

  const handleSaveLoop = async () => {
    if (!canSubmit) return;
    try {
      if (editingLoop) await onUpdateLoop(editingLoop.id, buildLoopPayload());
      else await onCreateLoop(buildLoopPayload());
    } catch (err) {
      toastError(editingLoop ? 'Failed to save loop' : 'Failed to create loop', err);
      return;
    }
    clearForm();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoop) return handleSaveLoop();
    return handleStart();
  };

  const handleKeyDown = async (e) => {
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLoop) return handleSaveLoop();
      return handleStart();
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

  const retryVariantWithPreference = (newFast, newEffort) => {
    const baseParams = selectedVariant?.params ?? [];
    const mergedParams = applyParamOverrides(baseParams, newFast, newEffort);
    const mergedStr = JSON.stringify(mergedParams);
    const withPreferenceVariantIdx = variants.findIndex((v) => {
      try {
        return JSON.stringify(v.params) === mergedStr;
      } catch {
        return false;
      }
    });
    if (withPreferenceVariantIdx >= 0) setCursorVariantIdx(withPreferenceVariantIdx);
  };

  const promptTextarea = (
    <textarea
      ref={initialPromptRef}
      value={initialPrompt}
      onChange={(e) => setInitialPrompt(e.target.value)}
      onKeyDown={handleKeyDown}
      rows={3}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 pr-9 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent overflow-y-auto resize-none"
      placeholder={
        isLoop
          ? 'Describe what the agent should do on every run...'
          : 'Describe what you want the agent to do...'
      }
      required
    />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* A loop being edited stays a loop, so the tabs give way to a title and a way out. */}
      {editingLoop ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-zinc-800 pb-2 -mt-1 text-sm font-medium text-white">
          <Repeat className="w-4 h-4 shrink-0 text-amber-400" />
          <span className="truncate">
            Editing loop
            {editingLoop.name ? <span className="text-zinc-400"> · {editingLoop.name}</span> : ''}
          </span>
        </div>
      ) : (
        onCreateLoop && (
          <div className="flex gap-1 border-b border-zinc-800 -mt-1">
            {[
              { value: 'session', label: 'Session' },
              { value: 'loop', label: 'Loop' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setMode(tab.value)}
                className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                  mode === tab.value
                    ? 'border-amber-500 text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )
      )}

      {isLoop && (
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">
            Loop label <span className="text-zinc-500 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={loopName}
            onChange={(e) => setLoopName(e.target.value)}
            placeholder="Nightly dependency check"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent"
          />
        </div>
      )}

      {allowRepoChoice && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-300">Repository</label>
          <RepoPicker
            includeAllSessions={false}
            includeManage
            navigateOnSelect={false}
            syncContext={false}
            showOrgInLabel
            fullWidth
            value={targetScope}
            onChange={setTargetScope}
          />
        </div>
      )}

      {!isGlobal && (
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
          {!allowRepoChoice && (
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
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          {isLoop ? 'Prompt' : 'Initial Prompt'}
        </label>
        {/* Attachments are a one-off input for a single run, so a loop takes the prompt alone. */}
        {isLoop ? (
          promptTextarea
        ) : (
          <FileAttachmentPicker
            files={files}
            onAdd={handleAddFiles}
            onRemove={handleRemoveFile}
            error={fileError}
          >
            {promptTextarea}
          </FileAttachmentPicker>
        )}
      </div>

      {isLoop && (
        <>
          <LoopScheduleFields schedule={schedule} onChange={setSchedule} />

          <div className="flex items-center gap-4">
            <button
              type="button"
              role="switch"
              aria-checked={singleSession}
              onClick={() => setSingleSession((v) => !v)}
              className="flex items-center gap-2 group"
            >
              <span
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${singleSession ? 'bg-amber-500' : 'bg-zinc-600'}`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${singleSession ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                />
              </span>
              <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
                Single session
              </span>
            </button>
            <Tooltip
              content={
                <span className="block max-w-xs whitespace-normal leading-relaxed">
                  On: every run continues in the same session, on one worktree and branch — the
                  conversation is compacted first, then the prompt is sent again, so the agent keeps
                  a summary of what it already did.
                  <br />
                  Off: each run starts a fresh session on its own branch.
                </span>
              }
            >
              <HelpCircle className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400 transition-colors" />
            </Tooltip>
          </div>
        </>
      )}

      {hasMoreOptions && (
        <div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${showMore ? 'rotate-90' : ''}`}
            />
            More options
          </button>

          {showMore && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3">
              {/* A loop reuses its template on every run, so a fixed branch name would clash. */}
              {createNewBranch && !isLoop && !isGlobal && (
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Branch name{' '}
                    <span className="text-zinc-500 font-normal">
                      (optional, auto-generated if empty)
                    </span>
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
      )}

      {/* Both are fixed on for a loop: every run needs its own branch, pushed for review. */}
      {!isLoop && !isGlobal && (
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
      )}

      {/* SDK + Model + (variant) on the left; Start/Plan on the right */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        {/* Left: selects + variant link */}
        <div>
          {userSettings && availableSdks.length === 0 && (
            <p className="text-sm text-amber-200/90 mb-2">
              Add a Claude or Cursor API key in{' '}
              <Link
                to="/settings?tab=agent"
                className="text-amber-400 hover:text-amber-300 underline"
              >
                Settings → Agent
              </Link>{' '}
              (or a per-repo key under Settings → Repositories) to start a session.
            </p>
          )}
          <div className="flex items-center gap-2">
            {userSettings && availableSdks.length === 1 && (
              <span className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white">
                {availableSdks[0] === 'cursor' ? 'Cursor' : 'Claude'}
              </span>
            )}
            {userSettings && availableSdks.length > 1 && (
              <select
                value={agentSdk}
                onChange={(e) => setAgentSdk(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                {availableSdks.includes('claude') && <option value="claude">Claude</option>}
                {availableSdks.includes('cursor') && <option value="cursor">Cursor</option>}
              </select>
            )}

            {availableSdks.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setCursorVariantIdx(null);
                    setVariantExpanded(false);
                  }}
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
            )}
          </div>

          {/* Cursor variant + preferences selectors */}
          {availableSdks.length > 0 && isCursor && (
            <div className="mt-1 ml-px">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {variants.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setVariantExpanded((v) => !v);
                      setPrefsExpanded(false);
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                  >
                    <span>
                      {selectedVariant
                        ? variantLabel(selectedVariant, selectedModel?.display_name)
                        : 'Select variant'}
                    </span>
                    <ChevronDown
                      className={`w-2.5 h-2.5 transition-transform ${variantExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPrefsExpanded((v) => !v);
                    setVariantExpanded(false);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                >
                  <span>preferences</span>
                  <ChevronDown
                    className={`w-2.5 h-2.5 transition-transform ${prefsExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
              {variants.length > 0 && variantExpanded && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {variants.map((v, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setCursorVariantIdx(i);
                        setVariantExpanded(false);
                      }}
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
              {prefsExpanded && (
                <div className="mt-1.5 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-500 w-10">fast:</span>
                    {['default', 'yes', 'no'].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setCursorFast(val);
                          retryVariantWithPreference(val, cursorEffort);
                        }}
                        className={`px-2.5 py-1 rounded text-xs transition-colors border ${
                          cursorFast === val
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-500 w-10">effort:</span>
                    {['default', 'low', 'medium', 'high', 'xhigh'].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setCursorEffort(val);
                          retryVariantWithPreference(cursorFast, val);
                        }}
                        className={`px-2.5 py-1 rounded text-xs transition-colors border ${
                          cursorEffort === val
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Create for a loop, Start / Plan for a one-off session */}
        <div className="flex items-center gap-3 sm:ml-auto">
          {editingLoop && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-5 py-2 rounded-md text-sm font-medium transition-colors border border-zinc-700"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-5 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {isLoop ? (editingLoop ? 'Save' : 'Create') : loading ? 'Creating...' : 'Start'}
          </button>
          {!isLoop && (
            <button
              type="button"
              onClick={handlePlan}
              disabled={!canSubmit}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 hover:text-white px-5 py-2 rounded-md text-sm font-medium transition-colors border border-zinc-700 disabled:border-zinc-700"
            >
              Plan
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
