import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, HelpCircle, Repeat } from 'lucide-react';
import Alert from './Alert.jsx';
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
import AgentMessageComposer from './AgentMessageComposer.jsx';
import ComposerPrimaryMenuAddon from './ComposerPrimaryMenuAddon.jsx';
import FileAttachmentPicker from './FileAttachmentPicker.jsx';
import SearchableSelect from './SearchableSelect';
import RepoPicker from './RepoPicker.jsx';
import { isMobile } from '../utils/isMobile.js';
import { applyParamOverrides } from '../utils/models.js';

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
}) {
  const persistKey = editingLoop
    ? null
    : allowRepoChoice
      ? 'builder-form-all'
      : `builder-form-${isGlobalProp ? 'global' : repoFullNameProp}`;
  const persistentState = usePersistentState(persistKey);
  const globalState = usePersistentState('builder-form-global');
  const { repos, loading: loadingRepos } = useRepoContext();
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const defaultTarget = editingLoop
    ? editingLoop.is_global
      ? GLOBAL_SCOPE
      : editingLoop.repo_full_name
    : allowRepoChoice
      ? (repos[0]?.full_name ?? GLOBAL_SCOPE)
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
  const [branchName, setBranchName] = persistentState.useState('branchName', '');
  const [autoPush, setAutoPush] = persistentState.useState('autoPush', true);
  const { user } = useAuth();
  const [userSettings, setUserSettings] = useState(null);
  const [agentSdk, setAgentSdkRaw] = persistentState.useState(
    'agentSdk',
    editingLoop?.agent_sdk ?? 'claude'
  );
  const [model, setModel] = persistentState.useState('model', editingLoop?.model ?? '');
  const [cursorVariantIdx, setCursorVariantIdx] = useState(null);
  const [models, setModels] = useState([]);
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
  // Holds model_params string from the last session (or the loop being edited), used to seed
  // cursorVariantIdx on model load
  const pendingModelParamsRef = useRef(editingLoop?.model_params ?? null);
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

  const loadModels = () => {
    const getUrl =
      agentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    return apiFetch(getUrl)
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
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
            cursorModelPrefs,
            variants
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
          cursorModelPrefs,
          variants
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
  const hasMoreOptions = (!isGlobal && !isLoop) || availablePlugins.length > 0;
  const canSubmit =
    !loading &&
    availableSdks.length > 0 &&
    (isGlobal || (repos.length > 0 && repoFullName && branch)) &&
    initialPrompt &&
    (!isLoop || isScheduleComplete(schedule));

  const clearForm = () => {
    const keepTarget = allowRepoChoice ? targetScope : null;
    persistentState.clear();
    if (keepTarget) setTargetScope(keepTarget);
    setFiles([]);
    setFileError(null);
    setLoopName('');
  };

  const buildPayload = ({ planMode, createNewBranch = true }) => {
    const selectedModel = isCursor ? models.find((m) => m.id === model) : null;
    const selectedVariant =
      selectedModel?.variants != null && cursorVariantIdx != null
        ? selectedModel.variants[cursorVariantIdx]
        : null;
    const finalParams = isCursor
      ? applyParamOverrides(
          selectedVariant?.params ?? [],
          cursorModelPrefs,
          selectedModel?.variants ?? []
        )
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
    if (await onSubmit(buildPayload({ planMode: false, createNewBranch: true }))) clearForm();
  };

  const handleContinue = async () => {
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: false, createNewBranch: false }))) clearForm();
  };

  const handlePlan = async () => {
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: true, createNewBranch: true }))) clearForm();
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

  const handleComposerSubmit = async (e) => {
    e.preventDefault();
    if (isLoop) return handleSaveLoop();
    return handleStart();
  };

  const handleComposerModelChange = (modelId, modelParamsJson) => {
    setModel(modelId);
    if (!isCursor || !modelParamsJson) {
      setCursorVariantIdx(null);
      return;
    }
    const m = models.find((x) => x.id === modelId);
    const modelVariants = m?.variants ?? [];
    let idx = modelVariants.findIndex((v) => {
      try {
        return JSON.stringify(v.params) === modelParamsJson;
      } catch {
        return false;
      }
    });
    if (idx < 0) {
      try {
        const parsed = JSON.parse(modelParamsJson);
        idx = modelVariants.findIndex((v) =>
          v.params?.every((p) => parsed.some((sp) => sp.id === p.id && sp.value === p.value))
        );
      } catch {
        idx = -1;
      }
    }
    setCursorVariantIdx(idx >= 0 ? idx : null);
  };

  const composerSession = useMemo(() => {
    const m = isCursor ? models.find((item) => item.id === model) : null;
    const modelVariants = m?.variants ?? [];
    const variant = cursorVariantIdx != null ? modelVariants[cursorVariantIdx] : null;
    const params =
      isCursor && variant
        ? applyParamOverrides(variant.params ?? [], cursorModelPrefs, modelVariants)
        : null;
    return {
      agent_sdk: availableSdks.includes(agentSdk) ? agentSdk : (availableSdks[0] ?? agentSdk),
      model: model || null,
      model_params: params?.length ? JSON.stringify(params) : null,
    };
  }, [agentSdk, model, isCursor, models, cursorVariantIdx, cursorModelPrefs, availableSdks]);

  const composerToolbarExtra = editingLoop ? (
    <button
      type="button"
      onClick={onCancelEdit}
      className="inline-flex items-center justify-center shrink-0 h-8 px-3 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
    >
      Cancel
    </button>
  ) : null;

  const composerPlaceholder = isLoop
    ? 'Describe what the agent should do on every run...'
    : 'Describe what you want the agent to do...';

  const renderComposer = (attachButton = null) => (
    <AgentMessageComposer
      skipColumn
      formClassName=""
      value={initialPrompt}
      onChange={setInitialPrompt}
      onSubmit={handleComposerSubmit}
      placeholder={composerPlaceholder}
      disabled={availableSdks.length === 0}
      sending={loading}
      session={composerSession}
      models={models}
      cursorModelPrefs={cursorModelPrefs}
      onCursorModelPrefChange={setCursorModelPref}
      onModelChange={handleComposerModelChange}
      availableSdks={availableSdks}
      onSdkChange={setAgentSdk}
      submitDisabled={!canSubmit}
      submitLabel={isLoop ? (editingLoop ? 'Save' : 'Create') : loading ? 'Creating...' : 'Start'}
      submitTooltip={
        !isLoop ? 'Branches out of the selected branch, which could create a new PR.' : undefined
      }
      sendAddon={
        !isLoop ? (
          <ComposerPrimaryMenuAddon
            disabled={!canSubmit || loading}
            title="Other ways to start"
            items={[
              { label: 'Plan', onSelect: handlePlan },
              ...(!isGlobal ? [{ label: 'Continue branch', onSelect: handleContinue }] : []),
            ]}
          />
        ) : undefined
      }
      toolbarExtra={
        <>
          {attachButton}
          {composerToolbarExtra}
        </>
      }
      autoFocus={!isMobile()}
    />
  );

  const handleAddFiles = (picked) => {
    setFileError(null);
    setFiles((prev) => [...prev, ...picked]);
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const { owner: repoOwner, name: repoName } = parseRepoFullName(repoFullName);

  return (
    <div className="space-y-4">
      {userSettings && availableSdks.length === 0 && (
        <Alert variant="alert">
          Add a Claude or Cursor API key in <Link to="/settings?tab=agent">Settings → Agent</Link>{' '}
          to start a session.
        </Alert>
      )}
      {!loadingRepos && !isGlobal && repos.length === 0 && (
        <Alert variant="info">
          Add a repository in <Link to="/settings?tab=repos">Settings → Repositories</Link> to start
          a coding session.
        </Alert>
      )}
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
            matchTriggerWidth
            triggerClassName="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white hover:text-white justify-between focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent"
            value={targetScope}
            onChange={setTargetScope}
          />
        </div>
      )}

      {!isGlobal && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Branch</label>
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
        {!isLoop && (
          <div className="flex flex-wrap items-baseline justify-end gap-2 mb-1">
            <Link
              to="/settings?tab=agent&prompt=session#settings-agent-prompts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-amber-400 hover:text-amber-300 underline"
            >
              Configure the system prompt
            </Link>
          </div>
        )}
        {/* Attachments are a one-off input for a single run, so a loop takes the prompt alone. */}
        {isLoop ? (
          renderComposer()
        ) : (
          <FileAttachmentPicker
            files={files}
            onAdd={handleAddFiles}
            onRemove={handleRemoveFile}
            error={fileError}
          >
            {({ attachButton }) => renderComposer(attachButton)}
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
              {!isLoop && !isGlobal && (
                <>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Branch name{' '}
                      <span className="text-zinc-500 font-normal">
                        (optional, for Start — auto-generated if empty)
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
                  <div className="sm:col-span-2">
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
                      <span className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors">
                        Auto-push
                      </span>
                    </button>
                    <p className="mt-1 text-xs text-zinc-500">
                      When enabled, the agent pushes commits to the remote after each turn.
                    </p>
                  </div>
                </>
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
    </div>
  );
}
