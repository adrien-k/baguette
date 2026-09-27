import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Layers } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toastError } from '../../utils/toastError.jsx';
import { apiFetch } from '../../api.js';
import { usersService, userReposService } from '../../feathers.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
import AgentSdkModelsSection from '../../components/AgentSdkModelsSection.jsx';
import UsageGraph from '../../components/UsageGraph.jsx';
import RepoDropdown, { repoDropdownRepoSections } from '../../components/RepoDropdown.jsx';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';

const PROMPT_KINDS = [
  { id: 'session', label: 'Session agent' },
  { id: 'review', label: 'Review' },
];
const PROMPT_KIND_IDS = new Set(PROMPT_KINDS.map((k) => k.id));

function normalizePromptKind(param) {
  if (param === 'builder') return 'session';
  return PROMPT_KIND_IDS.has(param) ? param : 'session';
}

function SaveRow({ saving, saved, onSave, disabled }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <span className="text-sm text-emerald-400">Saved</span>}
    </div>
  );
}

export default function AgentSettingsTab({ settings, onSave }) {
  const { user } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();
  const promptsSectionRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const promptParam = searchParams.get('prompt');

  const [claudeRepoId, setClaudeRepoId] = useState('');
  const [cursorRepoId, setCursorRepoId] = useState('');
  const [promptsRepoId, setPromptsRepoId] = useState('');

  const [anthropicApiKey, setAnthropicApiKey] = useState(null);
  const [anthropicApiKeyDirty, setAnthropicApiKeyDirty] = useState(false);
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);

  const [agentPrompt, setAgentPrompt] = useState('');
  const [reviewPrompt, setReviewPrompt] = useState('');
  const [promptKind, setPromptKind] = useState(() => normalizePromptKind(promptParam));
  const [fullSessionPrompt, setFullSessionPrompt] = useState('');
  const [fullReviewPrompt, setFullReviewPrompt] = useState('');

  const [claudeSaving, setClaudeSaving] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorSaved, setCursorSaved] = useState(false);
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);

  const repoById = useCallback((id) => repos.find((r) => String(r.id) === String(id)), [repos]);

  const loadClaudeFields = useCallback(() => {
    if (!claudeRepoId) {
      setAnthropicApiKey(null);
      setAnthropicApiKeyDirty(false);
      return;
    }
    setAnthropicApiKey(null);
    setAnthropicApiKeyDirty(false);
  }, [claudeRepoId, repoById]);

  const loadCursorFields = useCallback(() => {
    if (!cursorRepoId) {
      setCursorApiKey(null);
      setCursorApiKeyDirty(false);
    } else {
      setCursorApiKey(null);
      setCursorApiKeyDirty(false);
    }
  }, [cursorRepoId]);

  const loadPromptFields = useCallback(() => {
    if (!settings) return;
    if (!promptsRepoId) {
      setAgentPrompt(settings.agent_prompt ?? '');
      setReviewPrompt(settings.review_prompt ?? '');
      return;
    }
    const r = repoById(promptsRepoId);
    setAgentPrompt(r?.agent_prompt ?? '');
    setReviewPrompt(r?.review_prompt ?? '');
  }, [settings, promptsRepoId, repoById]);

  useEffect(() => {
    loadClaudeFields();
  }, [loadClaudeFields, settings]);

  useEffect(() => {
    loadCursorFields();
  }, [loadCursorFields, settings]);

  useEffect(() => {
    loadPromptFields();
  }, [loadPromptFields]);

  useEffect(() => {
    if (promptParam) setPromptKind(normalizePromptKind(promptParam));
  }, [promptParam]);

  useEffect(() => {
    if (!settings) return;
    const kind = promptParam ? normalizePromptKind(promptParam) : null;
    const hashTarget =
      typeof window !== 'undefined' && window.location.hash === '#settings-agent-prompts';
    if (!hashTarget && kind !== 'session' && kind !== 'review') return;
    const timer = window.setTimeout(() => {
      promptsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [promptParam, settings]);

  const setPromptKindInUrl = useCallback(
    (kind) => {
      setPromptKind(kind);
      setSearchParams({ tab: 'agent', prompt: kind });
    },
    [setSearchParams]
  );

  useEffect(() => {
    apiFetch('/api/settings/prompt-templates')
      .then((d) => {
        setFullSessionPrompt(d.session || '');
        setFullReviewPrompt(d.review || '');
      })
      .catch(() => {});
  }, []);

  const flashSaved = (setSaved) => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveClaude = async () => {
    if (!user?.id) return;
    setClaudeSaving(true);
    setClaudeSaved(false);
    try {
      if (!claudeRepoId) {
        const patch = {};
        if (anthropicApiKeyDirty) patch.anthropic_api_key = anthropicApiKey ?? '';
        if (!anthropicApiKeyDirty) {
          setClaudeSaving(false);
          return;
        }
        const updated = await usersService.patch(user.id, patch);
        onSave(updated);
      } else {
        const r = repoById(claudeRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        if (!anthropicApiKeyDirty) {
          setClaudeSaving(false);
          return;
        }
        await userReposService.patch(r.user_repo_id, {
          anthropic_api_key: anthropicApiKey ?? '',
        });
        await refetchRepos();
      }
      setAnthropicApiKey(null);
      setAnthropicApiKeyDirty(false);
      flashSaved(setClaudeSaved);
    } catch (err) {
      toastError('Failed to save Claude credential', err);
    } finally {
      setClaudeSaving(false);
    }
  };

  const handleSaveCursor = async () => {
    if (!user?.id) return;
    setCursorSaving(true);
    setCursorSaved(false);
    try {
      if (!cursorRepoId) {
        if (!cursorApiKeyDirty) return;
        const updated = await usersService.patch(user.id, {
          cursor_api_key: cursorApiKey ?? '',
        });
        onSave(updated);
      } else {
        const r = repoById(cursorRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        if (!cursorApiKeyDirty) return;
        await userReposService.patch(r.user_repo_id, {
          cursor_api_key: cursorApiKey ?? '',
        });
        await refetchRepos();
      }
      setCursorApiKey(null);
      setCursorApiKeyDirty(false);
      flashSaved(setCursorSaved);
    } catch (err) {
      toastError('Failed to save Cursor API key', err);
    } finally {
      setCursorSaving(false);
    }
  };

  const handleSavePrompts = async () => {
    if (!user?.id) return;
    setPromptsSaving(true);
    setPromptsSaved(false);
    try {
      if (!promptsRepoId) {
        const updated = await usersService.patch(user.id, {
          agent_prompt: agentPrompt,
          review_prompt: reviewPrompt,
        });
        onSave(updated);
      } else {
        const r = repoById(promptsRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        await userReposService.patch(r.user_repo_id, {
          agent_prompt: agentPrompt,
          review_prompt: reviewPrompt,
        });
        await refetchRepos();
      }
      flashSaved(setPromptsSaved);
    } catch (err) {
      toastError('Failed to save prompts', err);
    } finally {
      setPromptsSaving(false);
    }
  };

  const claudeMasked = claudeRepoId
    ? repoById(claudeRepoId)?.anthropic_api_key
    : settings?.anthropic_api_key;
  const cursorMasked = cursorRepoId
    ? repoById(cursorRepoId)?.cursor_api_key
    : settings?.cursor_api_key;

  const repoScopeSections = useMemo(
    () => [
      {
        options: [
          {
            value: '',
            label: 'All sessions',
            icon: <Layers className="w-3.5 h-3.5 shrink-0" />,
          },
        ],
      },
      ...repoDropdownRepoSections(repos, (r) => r.id),
    ],
    [repos]
  );

  const repoScopeAside = (id, value, onChange) => (
    <RepoDropdown
      id={id}
      value={value}
      onChange={onChange}
      sections={repoScopeSections}
      ariaLabel="Repository scope"
      triggerTitle={value ? 'Repository scope: this repo only' : 'Repository scope: all sessions'}
    />
  );

  return (
    <div>
      <SettingsTabHeader title="Agent">
        Cursor model defaults (account-wide), then credentials and prompts scoped to all sessions or
        a single repository.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Cursor model preferences"
          description="Used when starting Cursor sessions from the dashboard, builder, and MCP."
        >
          <CursorModelPreferencesSection />
        </SettingsSection>

        <SettingsSection
          title="Claude"
          headerAside={repoScopeAside('claude-repo-scope', claudeRepoId, setClaudeRepoId)}
        >
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Credential</label>
            <MaskedSecretInput
              key={`claude-${claudeRepoId || 'all'}`}
              maskedValue={claudeMasked}
              placeholder="sk-ant-…"
              onChange={(val, dirty) => {
                setAnthropicApiKey(val);
                setAnthropicApiKeyDirty(dirty);
              }}
            />
            <p className="mt-1 text-xs text-zinc-500">
              Console API key (<code className="text-zinc-400">sk-ant-api…</code>) or subscription
              token from <code className="text-zinc-400">claude setup-token</code>. Per-repo keys
              override your account default for that repository only.
            </p>
          </div>
          <AgentSdkModelsSection sdk="claude" />
          <UsageGraph agentSdkFilter="claude" />
          <SaveRow
            saving={claudeSaving}
            saved={claudeSaved}
            onSave={handleSaveClaude}
            disabled={!anthropicApiKeyDirty}
          />
        </SettingsSection>

        <SettingsSection
          title="Cursor"
          headerAside={repoScopeAside('cursor-repo-scope', cursorRepoId, setCursorRepoId)}
        >
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">API Key</label>
            <MaskedSecretInput
              key={`cursor-${cursorRepoId || 'all'}`}
              maskedValue={cursorMasked}
              placeholder="cursor-…"
              onChange={(val, dirty) => {
                setCursorApiKey(val);
                setCursorApiKeyDirty(dirty);
              }}
            />
            <p className="mt-1 text-xs text-zinc-500">Required to use the Cursor agent SDK.</p>
          </div>
          <AgentSdkModelsSection
            key={`cursor-models-${cursorRepoId || 'all'}-${cursorMasked ? '1' : '0'}`}
            sdk="cursor"
            credentialConfigured={Boolean(cursorMasked)}
          />
          <UsageGraph agentSdkFilter="cursor" />
          <SaveRow
            saving={cursorSaving}
            saved={cursorSaved}
            onSave={handleSaveCursor}
            disabled={!cursorApiKeyDirty}
          />
        </SettingsSection>

        <div ref={promptsSectionRef} id="settings-agent-prompts" className="scroll-mt-6">
          <SettingsSection
            title="Prompts"
            description="Extend built-in system prompts. Agents load paths and branches via the CurrentSessionInfo MCP tool."
            headerAside={repoScopeAside('prompts-repo-scope', promptsRepoId, setPromptsRepoId)}
          >
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Prompt type</label>
              <select
                value={promptKind}
                onChange={(e) => setPromptKindInUrl(e.target.value)}
                className="w-full sm:w-auto bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                {PROMPT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            {promptKind === 'session' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Built-in session prompt
                  </label>
                  <textarea
                    value={fullSessionPrompt}
                    readOnly
                    rows={20}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500 font-mono min-h-[28rem] cursor-default resize-y"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    {promptsRepoId
                      ? 'Repository session instructions'
                      : 'Additional session instructions'}
                  </label>
                  <textarea
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    rows={8}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 min-h-32"
                    placeholder="Always run tests before committing…"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Built-in review prompt
                  </label>
                  <textarea
                    value={fullReviewPrompt}
                    readOnly
                    rows={20}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500 font-mono min-h-[28rem] cursor-default resize-y"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    {promptsRepoId
                      ? 'Repository review instructions'
                      : 'Additional review instructions'}
                  </label>
                  <textarea
                    value={reviewPrompt}
                    onChange={(e) => setReviewPrompt(e.target.value)}
                    rows={8}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 min-h-32"
                    placeholder="Focus on security, require tests for behavior changes…"
                  />
                </div>
              </>
            )}
            <SaveRow saving={promptsSaving} saved={promptsSaved} onSave={handleSavePrompts} />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
