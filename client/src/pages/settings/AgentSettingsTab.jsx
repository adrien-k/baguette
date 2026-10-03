import { useState, useEffect, useCallback } from 'react';
import { toastError } from '../../utils/toastError.jsx';
import { usersService, userReposService } from '../../feathers.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import TextInput from '../../components/TextInput.jsx';
import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
import AgentSessionDefaultsSection from './AgentSessionDefaultsSection.jsx';
import AgentSdkModelsSection from '../../components/AgentSdkModelsSection.jsx';
import {
  SettingsSection,
  SettingsTabHeader,
  SettingsSaveRow,
} from '../../components/SettingsSection.jsx';
import { RepoScopeAside } from './repoScopeDropdown.jsx';

export default function AgentSettingsTab({ settings, onSave }) {
  const { user } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();

  const [claudeRepoId, setClaudeRepoId] = useState('');
  const [cursorRepoId, setCursorRepoId] = useState('');

  const [anthropicApiKey, setAnthropicApiKey] = useState(null);
  const [anthropicApiKeyDirty, setAnthropicApiKeyDirty] = useState(false);
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('');
  const [anthropicBaseUrlDirty, setAnthropicBaseUrlDirty] = useState(false);
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);

  const [claudeSaving, setClaudeSaving] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorSaved, setCursorSaved] = useState(false);

  const repoById = useCallback((id) => repos.find((r) => String(r.id) === String(id)), [repos]);

  const loadClaudeFields = useCallback(() => {
    setAnthropicApiKey(null);
    setAnthropicApiKeyDirty(false);
    const scopeRepo = claudeRepoId ? repoById(claudeRepoId) : null;
    const baseUrl = scopeRepo?.anthropic_base_url ?? settings?.anthropic_base_url ?? '';
    setAnthropicBaseUrl(baseUrl || '');
    setAnthropicBaseUrlDirty(false);
  }, [claudeRepoId, repoById, settings?.anthropic_base_url]);

  const loadCursorFields = useCallback(() => {
    if (!cursorRepoId) {
      setCursorApiKey(null);
      setCursorApiKeyDirty(false);
    } else {
      setCursorApiKey(null);
      setCursorApiKeyDirty(false);
    }
  }, [cursorRepoId]);

  useEffect(() => {
    loadClaudeFields();
  }, [loadClaudeFields, settings]);

  useEffect(() => {
    loadCursorFields();
  }, [loadCursorFields, settings]);

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
        if (anthropicBaseUrlDirty) patch.anthropic_base_url = anthropicBaseUrl.trim();
        if (!anthropicApiKeyDirty && !anthropicBaseUrlDirty) {
          setClaudeSaving(false);
          return;
        }
        const updated = await usersService.patch(user.id, patch);
        onSave(updated);
      } else {
        const r = repoById(claudeRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        if (!anthropicApiKeyDirty && !anthropicBaseUrlDirty) {
          setClaudeSaving(false);
          return;
        }
        const repoPatch = {};
        if (anthropicApiKeyDirty) repoPatch.anthropic_api_key = anthropicApiKey ?? '';
        if (anthropicBaseUrlDirty) repoPatch.anthropic_base_url = anthropicBaseUrl.trim();
        await userReposService.patch(r.user_repo_id, repoPatch);
        await refetchRepos();
      }
      setAnthropicApiKey(null);
      setAnthropicApiKeyDirty(false);
      setAnthropicBaseUrlDirty(false);
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

  const claudeMasked = claudeRepoId
    ? repoById(claudeRepoId)?.anthropic_api_key
    : settings?.anthropic_api_key;
  const cursorMasked = cursorRepoId
    ? repoById(cursorRepoId)?.cursor_api_key
    : settings?.cursor_api_key;

  return (
    <div>
      <SettingsTabHeader title="Agent">
        Session default agent and Cursor model preferences (account-wide), then Claude and Cursor
        credentials scoped to all my repos or a single repository. System prompts live under
        Prompts.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Session default agent"
          description="Default is last used agent (most recent session). Or pin Claude/Cursor with model and params. MCP explicit parameters always override."
        >
          <AgentSessionDefaultsSection settings={settings} />
        </SettingsSection>

        <SettingsSection
          title="Cursor model preferences"
          description="Used when starting Cursor sessions from the dashboard, builder, and MCP. If a model does not offer a strict match for a parameter, Baguette selects the closest available option (for example the nearest context size or the next lower effort or reasoning tier)."
        >
          <CursorModelPreferencesSection />
        </SettingsSection>

        <SettingsSection
          title="Claude"
          headerAside={
            <RepoScopeAside
              id="claude-repo-scope"
              value={claudeRepoId}
              onChange={setClaudeRepoId}
              repos={repos}
            />
          }
        >
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Credential</label>
            <MaskedSecretInput
              key={`claude-${claudeRepoId || 'all'}`}
              maskedValue={claudeMasked}
              placeholder="sk-ant-…"
              onChange={(val, dirty) => {
                setAnthropicApiKey(val);
                setAnthropicApiKeyDirty(dirty);
              }}
            />
            <p className="mt-1 text-xs text-faint">
              Console API key (<code className="text-fg-muted">sk-ant-api…</code>) or subscription
              token from <code className="text-fg-muted">claude setup-token</code>. Per-repo keys
              override your account default for that repository only.
            </p>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-secondary mb-1">API base URL</label>
            <TextInput
              type="url"
              key={`claude-base-url-${claudeRepoId || 'all'}`}
              className="font-mono text-sm"
              placeholder="https://api.anthropic.com"
              value={anthropicBaseUrl}
              onChange={(e) => {
                setAnthropicBaseUrl(e.target.value);
                setAnthropicBaseUrlDirty(true);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-faint">
              Optional. Route Claude through a proxy or gateway by setting{' '}
              <code className="text-fg-muted">ANTHROPIC_BASE_URL</code> (origin only — no{' '}
              <code className="text-fg-muted">/v1</code> suffix). Leave blank to use the server
              default. Per-repo values override your account default.
            </p>
          </div>
          <AgentSdkModelsSection sdk="claude" />
          <SettingsSaveRow
            saving={claudeSaving}
            saved={claudeSaved}
            onSave={handleSaveClaude}
            disabled={!anthropicApiKeyDirty && !anthropicBaseUrlDirty}
          />
        </SettingsSection>

        <SettingsSection
          title="Cursor"
          headerAside={
            <RepoScopeAside
              id="cursor-repo-scope"
              value={cursorRepoId}
              onChange={setCursorRepoId}
              repos={repos}
            />
          }
        >
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">API Key</label>
            <MaskedSecretInput
              key={`cursor-${cursorRepoId || 'all'}`}
              maskedValue={cursorMasked}
              placeholder="cursor-…"
              onChange={(val, dirty) => {
                setCursorApiKey(val);
                setCursorApiKeyDirty(dirty);
              }}
            />
            <p className="mt-1 text-xs text-faint">Required to use the Cursor agent SDK.</p>
          </div>
          <AgentSdkModelsSection
            key={`cursor-models-${cursorRepoId || 'all'}-${cursorMasked ? '1' : '0'}`}
            sdk="cursor"
            credentialConfigured={Boolean(cursorMasked)}
          />
          <SettingsSaveRow
            saving={cursorSaving}
            saved={cursorSaved}
            onSave={handleSaveCursor}
            disabled={!cursorApiKeyDirty}
          />
        </SettingsSection>
      </div>
    </div>
  );
}
