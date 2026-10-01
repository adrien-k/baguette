import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, HelpCircle, Repeat } from 'lucide-react';
import Alert from './Alert.jsx';
import GithubIcon from './svg/GithubIcon.jsx';
import LoopScheduleFields from './LoopScheduleFields.jsx';
import Tooltip from './Tooltip.jsx';
import { scheduleFromLoop, schedulePayload, isScheduleComplete } from '../utils/loopSchedule.js';
import { apiFetch } from '../api.js';
import { sessionsService, pluginsService } from '../feathers.js';
import { useCurrentUser } from '../context/CurrentUserContext.jsx';
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
import {
  applyParamOverrides,
  defaultModelForSdk,
  paramsJsonForModelChange,
  stringifyModelParams,
} from '../utils/models.js';
import Toggle from './Toggle.jsx';
import { INPUT_CLASS, INLINE_SECONDARY_LINK_CLASS } from '../utils/ui.js';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';

function parseRepoFullName(full) {
  if (!full) return { owner: '', name: '' };
  const i = full.indexOf('/');
  if (i === -1) return { owner: full, name: '' };
  return { owner: full.slice(0, i), name: full.slice(i + 1) };
}

/** How a one-shot session starts (Start button); menu picks mode without submitting. */
const SESSION_START_MODES = [
  {
    id: 'new-branch',
    label: 'New branch',
    subtitle: 'on a new branch',
    hint: 'Branches out of the selected branch, which creates a new PR.',
    planMode: false,
    createNewBranch: true,
    repoOnly: false,
  },
  {
    id: 'same-branch',
    label: 'Same branch',
    subtitle: 'on the same branch',
    hint: 'Work on the selected branch without creating a new one.',
    planMode: false,
    createNewBranch: false,
    repoOnly: true,
  },
  {
    id: 'plan',
    label: 'Plan',
    subtitle: 'planning',
    hint: 'Agent explores and plans before making changes.',
    planMode: true,
    createNewBranch: true,
    repoOnly: false,
  },
];

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
  mode: modeProp,
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
  const { currentUser: userSettings } = useCurrentUser();
  const [agentSdk, setAgentSdkRaw] = persistentState.useState(
    'agentSdk',
    editingLoop?.agent_sdk ?? 'claude'
  );
  const [model, setModel] = persistentState.useState('model', editingLoop?.model ?? '');
  const [modelParamsJson, setModelParamsJson] = persistentState.useState(
    'modelParams',
    editingLoop?.model_params ?? null
  );
  const [models, setModels] = useState([]);
  const [selectedPlugins, setSelectedPlugins] = persistentState.useState(
    'plugins',
    editingLoop?.plugins ?? []
  );
  const [availablePlugins, setAvailablePlugins] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [modeState, setModeState] = useState(editingLoop ? 'loop' : 'session');
  const mode = modeProp ?? modeState;
  const builderModeControlled = modeProp !== undefined;
  const [sessionStartMode, setSessionStartMode] = useState('new-branch');
  const [loopName, setLoopName] = useState(editingLoop?.name ?? '');
  const [singleSession, setSingleSession] = useState(!!editingLoop?.single_session);
  const [schedule, setSchedule] = useState(() => scheduleFromLoop(editingLoop));
  const initAppliedRef = useRef(false);
  const isCursor = agentSdk === 'cursor';

  const applySdkAndModel = (nextSdk, modelId, paramsJson) => {
    if (nextSdk) setAgentSdkRaw(nextSdk);
    if (modelId != null) setModel(modelId || '');
    setModelParamsJson(paramsJson ?? null);
  };

  const setAgentSdk = (nextSdk) => {
    setAgentSdkRaw(nextSdk);
    setModel('');
    setModelParamsJson(null);
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
    if (!availableSdks.length) return;
    if (!availableSdks.includes(agentSdk)) setAgentSdk(availableSdks[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setAgentSdk resets model state intentionally
  }, [availableSdks, agentSdk]);

  useEffect(() => {
    if (editingLoop || initAppliedRef.current || userSettings == null) return;
    const defaults = userSettings.agent_defaults;
    const useLastUsed = !defaults || defaults.use_last_used || !defaults.agent_sdk;
    if (!useLastUsed) {
      initAppliedRef.current = true;
      const sdk =
        defaults.agent_sdk && availableSdks.includes(defaults.agent_sdk)
          ? defaults.agent_sdk
          : null;
      applySdkAndModel(
        sdk,
        defaults.model || null,
        defaults.model_params?.length && defaults.agent_sdk === 'cursor'
          ? JSON.stringify(defaults.model_params)
          : null
      );
      return;
    }
    if (!repoFullName || isGlobal) {
      initAppliedRef.current = true;
      return;
    }
    let cancelled = false;
    sessionsService
      .find({ query: { repo_full_name: repoFullName, $limit: 5 } })
      .then((result) => {
        if (cancelled || initAppliedRef.current) return;
        initAppliedRef.current = true;
        const sessions = (result.data || []).filter((s) => s.agent_sdk || s.model);
        if (!sessions.length) return;
        const last = sessions[0];
        applySdkAndModel(last.agent_sdk, last.model, last.model_params || null);
      })
      .catch(() => {
        if (!cancelled) initAppliedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from defaults or last session
  }, [editingLoop, userSettings, availableSdks, repoFullName, isGlobal]);
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

  useEffect(() => {
    if (isGlobal && sessionStartMode === 'same-branch') setSessionStartMode('new-branch');
  }, [isGlobal, sessionStartMode]);

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

  // Validate/default model when models load after an SDK change
  useEffect(() => {
    if (!models.length) return;
    const current = models.find((m) => m.id === model);
    if (current) {
      if (isCursor && !modelParamsJson) {
        setModelParamsJson(paramsJsonForModelChange(current, cursorModelPrefs));
      }
      return;
    }
    const fallback = defaultModelForSdk(models);
    if (!fallback) return;
    setModel(fallback.id);
    setModelParamsJson(paramsJsonForModelChange(fallback, cursorModelPrefs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

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
    (!isLoop || (Boolean(initialPrompt.trim()) && isScheduleComplete(schedule)));

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
    const parsedParams = (() => {
      if (!isCursor || !modelParamsJson) return null;
      try {
        const parsed = JSON.parse(modelParamsJson);
        return Array.isArray(parsed) && parsed.length ? parsed : null;
      } catch {
        return null;
      }
    })();
    const finalParams = isCursor
      ? applyParamOverrides(parsedParams ?? [], cursorModelPrefs, selectedModel?.variants ?? [])
      : null;
    return {
      isGlobal,
      repoFullName,
      branch,
      initialPrompt,
      files,
      planMode,
      model: model || undefined,
      modelParams: isCursor ? stringifyModelParams(finalParams) : undefined,
      createNewBranch,
      branchName: branchName || undefined,
      autoPush,
      plugins: selectedPlugins.length > 0 ? selectedPlugins : undefined,
      agentSdk,
    };
  };

  const activeSessionStartMode =
    SESSION_START_MODES.find((m) => m.id === sessionStartMode) ?? SESSION_START_MODES[0];

  const handleStartSession = async () => {
    if (!canSubmit) return;
    const { planMode, createNewBranch } = activeSessionStartMode;
    if (await onSubmit(buildPayload({ planMode, createNewBranch }))) clearForm();
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
    return handleStartSession();
  };

  const handleComposerModelChange = (modelId, paramsJson) => {
    setModel(modelId);
    setModelParamsJson(paramsJson ?? null);
  };

  const composerToolbarExtra = editingLoop ? (
    <button
      type="button"
      onClick={onCancelEdit}
      className="inline-flex items-center justify-center shrink-0 h-8 px-3 rounded-md border border-strong bg-control hover:bg-control-hover text-secondary hover:text-fg text-xs font-medium transition-colors"
    >
      Cancel
    </button>
  ) : null;

  const composerPlaceholder = isLoop
    ? 'Describe what the agent should do on every run...'
    : isGlobal
      ? 'Describe what you want the agent to do. Leave empty to just open a session.'
      : 'Describe what you want the agent to do. Leave empty to just open a session on the selected branch.';

  const renderComposer = (attachButton = null) => (
    <AgentMessageComposer
      skipColumn
      formClassName=""
      resizable
      value={initialPrompt}
      onChange={setInitialPrompt}
      onSubmit={handleComposerSubmit}
      placeholder={composerPlaceholder}
      disabled={availableSdks.length === 0}
      sending={loading}
      sdk={availableSdks.includes(agentSdk) ? agentSdk : (availableSdks[0] ?? agentSdk)}
      model={model || null}
      params={modelParamsJson}
      autoPush={autoPush}
      models={models}
      cursorModelPrefs={cursorModelPrefs}
      onCursorModelPrefChange={setCursorModelPref}
      onModelChange={handleComposerModelChange}
      onAutoPushChange={setAutoPush}
      showAutoPushParam={!isGlobal && !isLoop}
      availableSdks={availableSdks}
      userSettings={userSettings}
      sdkRepo={selectedRepo}
      onSdkChange={setAgentSdk}
      canSend={canSubmit}
      submitDisabled={!canSubmit}
      submitLabel={isLoop ? (editingLoop ? 'Save' : 'Create') : loading ? 'Creating...' : 'Start'}
      submitSubtitle={!isLoop ? activeSessionStartMode.subtitle : undefined}
      sendAddon={
        !isLoop ? (
          <ComposerPrimaryMenuAddon
            disabled={loading}
            title="Start mode"
            panelClassName={`w-64 ${DROPDOWN_PANEL_CLASS} overflow-hidden py-1`}
            items={SESSION_START_MODES.filter((m) => !m.repoOnly || !isGlobal).map((m) => ({
              label: m.label,
              hint: m.hint,
              selected: m.id === sessionStartMode,
              onSelect: () => setSessionStartMode(m.id),
            }))}
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
        <div className="flex min-w-0 items-center gap-2 border-b border-line pb-2 -mt-1 text-sm font-medium text-fg">
          <Repeat className="w-4 h-4 shrink-0 text-accent" />
          <span className="truncate">
            Editing loop
            {editingLoop.name ? <span className="text-faint"> · {editingLoop.name}</span> : ''}
          </span>
        </div>
      ) : (
        onCreateLoop &&
        !builderModeControlled && (
          <div className="flex gap-1 border-b border-line -mt-1">
            {[
              { value: 'session', label: 'Session' },
              { value: 'loop', label: 'Loop' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setModeState(tab.value)}
                className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                  mode === tab.value
                    ? 'border-brand text-fg'
                    : 'border-transparent text-faint hover:text-heading'
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
          <label className="block text-sm font-medium text-secondary mb-1">
            Loop label <span className="text-faint font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={loopName}
            onChange={(e) => setLoopName(e.target.value)}
            placeholder="Nightly dependency check"
            className={`${INPUT_CLASS} focus:border-transparent`}
          />
        </div>
      )}

      {(allowRepoChoice || !isGlobal) && (
        <div
          className={`grid grid-cols-1 gap-3 sm:gap-4 ${
            allowRepoChoice && !isGlobal ? 'sm:grid-cols-3' : ''
          }`}
        >
          {allowRepoChoice && (
            <div className="min-w-0">
              <label className="mb-1 block text-sm font-medium text-heading">Repository</label>
              <RepoPicker
                includeAllSessions={false}
                includeManage
                navigateOnSelect={false}
                syncContext={false}
                showOrgInLabel
                fullWidth
                matchTriggerWidth
                triggerClassName="bg-control border border-strong rounded-md px-3 py-2 text-fg hover:text-fg justify-between focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-transparent"
                value={targetScope}
                onChange={setTargetScope}
              />
            </div>
          )}

          {!isGlobal && (
            <div className={`min-w-0 space-y-2 ${allowRepoChoice ? 'sm:col-span-2' : ''}`}>
              <div>
                <label className="mb-1 block text-sm font-medium text-heading">Branch</label>
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
                    className="shrink-0 self-start px-1 py-2.5 text-sm leading-none text-faint hover:text-secondary disabled:opacity-40"
                  >
                    ↺
                  </button>
                </div>
              </div>
              {!allowRepoChoice && (
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-faint">
                  <GithubIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  {repoFullName ? (
                    <span className="min-w-0 truncate">
                      <span className="text-faint">{repoOwner}</span>
                      <span className="text-faint"> / </span>
                      <span className="text-fg-muted">{repoName}</span>
                    </span>
                  ) : (
                    <span className="text-faint">No repository selected</span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        {!isLoop && (
          <div className="flex flex-wrap items-baseline justify-end gap-2 mb-1">
            <Link
              to="/settings?tab=prompts#settings-prompt-session"
              target="_blank"
              rel="noopener noreferrer"
              className={INLINE_SECONDARY_LINK_CLASS}
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
            <Toggle
              checked={singleSession}
              onChange={setSingleSession}
              label="Single session"
              className="gap-2"
            />
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
              <HelpCircle className="w-3.5 h-3.5 text-faint hover:text-fg-muted transition-colors" />
            </Tooltip>
          </div>
        </>
      )}

      {hasMoreOptions && (
        <div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-heading transition-colors"
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
                    <label className="block text-sm font-medium text-secondary mb-1">
                      Branch name{' '}
                      <span className="text-faint font-normal">
                        (optional, for Start — auto-generated if empty)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder="my-feature-branch"
                      className={`${INPUT_CLASS} focus:border-transparent`}
                    />
                  </div>
                </>
              )}

              {availablePlugins.length > 0 && (
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-secondary mb-1.5">Plugins</label>
                  <div className="space-y-1.5">
                    {availablePlugins.map((plugin) => (
                      <label
                        key={plugin.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-strong/80 bg-control/40 px-3 py-2"
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
                          className="mt-0.5 rounded border-strong text-accent focus:ring-brand/50"
                        />
                        <span className="text-sm text-secondary leading-tight">
                          <span className="font-medium text-heading">{plugin.name}</span>
                          <span className="block text-xs font-normal text-faint mt-0.5">
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
