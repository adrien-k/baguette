import { useState, useEffect, useCallback } from 'react';
import { toastError } from '../../utils/toastError.jsx';
import { usersService, userReposService } from '../../feathers.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
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
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);

  const [claudeSaving, setClaudeSaving] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorSaved, setCursorSaved] = useState(false);

  const repoById = useCallback((id) => repos.find((r) => String(r.id) === String(id)), [repos]);

  const loadClaudeFields = useCallback(() => {
    if (!claudeRepoId) {
      setAnthropicApiKey(null);
      setAnthropicApiKeyDirty(false);
      return;
    }
    setAnthropicApiKey(null);
    setAnthropicApiKeyDirty(false);
  }, [claudeRepoId]);

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

  const claudeMasked = claudeRepoId
    ? repoById(claudeRepoId)?.anthropic_api_key
    : settings?.anthropic_api_key;
  const cursorMasked = cursorRepoId
    ? repoById(cursorRepoId)?.cursor_api_key
    : settings?.cursor_api_key;

  return (
    <div>
      <SettingsTabHeader title="Agent">
        Cursor model defaults (account-wide), then Claude and Cursor credentials scoped to all my
        repos or a single repository. System prompts live under Prompts.
      </SettingsTabHeader>

      <div className="space-y-6">
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
          <AgentSdkModelsSection sdk="claude" />
          <SettingsSaveRow
            saving={claudeSaving}
            saved={claudeSaved}
            onSave={handleSaveClaude}
            disabled={!anthropicApiKeyDirty}
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
