import { useState, useEffect, useCallback } from 'react';
import { toastError } from '../../utils/toastError.jsx';
import { usersService, userReposService } from '../../feathers.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useRepoContext } from '../../context/RepoContext.jsx';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import CursorModelPreferencesSection from '../../components/CursorModelPreferencesSection.jsx';
import AgentSessionDefaultsSection from './AgentSessionDefaultsSection.jsx';
import AgentSdkModelsSection from '../../components/AgentSdkModelsSection.jsx';
import AgentTestButton from '../../components/AgentTestButton.jsx';
import ClaudeAuthFields from '../../components/ClaudeAuthFields.jsx';
import PiAuthFields from '../../components/PiAuthFields.jsx';
import {
  SettingsSection,
  SettingsTabHeader,
  SettingsSaveRow,
} from '../../components/SettingsSection.jsx';
import { RepoScopeAside } from './repoScopeDropdown.jsx';
import {
  PI_API_KEY_ENV_VARS,
  effectivePiApiKeyEnvVar,
} from '@baguette/shared/pi-api-key-env-vars.js';

export default function AgentSettingsTab({ settings, onSave }) {
  const { user } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();

  const [claudeRepoId, setClaudeRepoId] = useState('');
  const [cursorRepoId, setCursorRepoId] = useState('');
  const [piRepoId, setPiRepoId] = useState('');

  // Claude field state lives inside ClaudeAuthFields; it reports the pending patch here.
  const [claudeChange, setClaudeChange] = useState({ patch: {}, hasChanges: false });
  const [piChange, setPiChange] = useState({ patch: {}, hasChanges: false });
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);

  const [claudeSaving, setClaudeSaving] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorSaved, setCursorSaved] = useState(false);
  const [piSaving, setPiSaving] = useState(false);
  const [piSaved, setPiSaved] = useState(false);

  const repoById = useCallback((id) => repos.find((r) => String(r.id) === String(id)), [repos]);

  const loadCursorFields = useCallback(() => {
    setCursorApiKey(null);
    setCursorApiKeyDirty(false);
  }, []);

  useEffect(() => {
    loadCursorFields();
  }, [loadCursorFields, cursorRepoId]);

  const flashSaved = (setSaved) => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveClaude = async () => {
    if (!user?.id) return;
    const { patch: claudePatch, hasChanges } = claudeChange;
    if (!hasChanges || !Object.keys(claudePatch).length) return;
    setClaudeSaving(true);
    setClaudeSaved(false);
    try {
      if (!claudeRepoId) {
        const updated = await usersService.patch(user.id, claudePatch);
        onSave(updated);
      } else {
        const r = repoById(claudeRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        await userReposService.patch(r.user_repo_id, claudePatch);
        await refetchRepos();
      }
      flashSaved(setClaudeSaved);
    } catch (err) {
      toastError('Failed to save Claude settings', err);
    } finally {
      setClaudeSaving(false);
    }
  };

  const handleSavePi = async () => {
    if (!user?.id) return;
    const { patch: piPatch, hasChanges } = piChange;
    if (!hasChanges || !Object.keys(piPatch).length) return;
    setPiSaving(true);
    setPiSaved(false);
    try {
      if (!piRepoId) {
        const updated = await usersService.patch(user.id, piPatch);
        onSave(updated);
      } else {
        const r = repoById(piRepoId);
        if (!r?.user_repo_id) throw new Error('Repository not linked');
        await userReposService.patch(r.user_repo_id, piPatch);
        await refetchRepos();
      }
      flashSaved(setPiSaved);
    } catch (err) {
      toastError('Failed to save Pi settings', err);
    } finally {
      setPiSaving(false);
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

  const claudeScopeRepo = claudeRepoId ? repoById(claudeRepoId) : null;
  const claudeMasked = claudeScopeRepo?.anthropic_api_key ?? settings?.anthropic_api_key ?? null;
  const claudeTokenMasked =
    claudeScopeRepo?.anthropic_auth_token ?? settings?.anthropic_auth_token ?? null;
  const claudeSavedBaseUrl =
    claudeScopeRepo?.anthropic_base_url ?? settings?.anthropic_base_url ?? '';
  const cursorMasked = cursorRepoId
    ? repoById(cursorRepoId)?.cursor_api_key
    : settings?.cursor_api_key;
  const piScopeRepo = piRepoId ? repoById(piRepoId) : null;
  const piMasked = piScopeRepo?.pi_api_key ?? settings?.pi_api_key ?? null;
  const piSavedEnvVar = effectivePiApiKeyEnvVar(settings ?? {}, piScopeRepo ?? null);
  const piEnvVarOptions = PI_API_KEY_ENV_VARS;

  return (
    <div>
      <SettingsTabHeader title="Agent">
        Session default agent and Cursor model preferences (account-wide), then Claude, Cursor, and
        Pi credentials scoped to all my repos or a single repository. System prompts live under
        Prompts.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Session default agent"
          description="Default is last used agent (most recent session). Or pin Claude/Cursor with model and params. MCP explicit parameters always override."
        >
          <AgentSessionDefaultsSection settings={settings} onSave={onSave} />
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
          <ClaudeAuthFields
            key={`claude-auth-${claudeRepoId || 'all'}`}
            maskedApiKey={claudeMasked}
            maskedAuthToken={claudeTokenMasked}
            savedBaseUrl={claudeSavedBaseUrl}
            repoId={claudeRepoId || null}
            perRepoHint
            onChange={(patch, hasChanges) => setClaudeChange({ patch, hasChanges })}
          />
          <AgentSdkModelsSection sdk="claude" repoId={claudeRepoId ? Number(claudeRepoId) : null} />
          <SettingsSaveRow
            saving={claudeSaving}
            saved={claudeSaved}
            onSave={handleSaveClaude}
            disabled={!claudeChange.hasChanges}
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
          <div className="mt-4">
            <AgentTestButton
              sdk="cursor"
              repoId={cursorRepoId || null}
              fields={cursorApiKeyDirty ? { cursor_api_key: cursorApiKey ?? '' } : {}}
            />
          </div>
          <AgentSdkModelsSection
            key={`cursor-models-${cursorRepoId || 'all'}`}
            sdk="cursor"
            repoId={cursorRepoId ? Number(cursorRepoId) : null}
          />
          <SettingsSaveRow
            saving={cursorSaving}
            saved={cursorSaved}
            onSave={handleSaveCursor}
            disabled={!cursorApiKeyDirty}
          />
        </SettingsSection>

        <SettingsSection
          title="Pi"
          headerAside={
            <RepoScopeAside
              id="pi-repo-scope"
              value={piRepoId}
              onChange={setPiRepoId}
              repos={repos}
            />
          }
        >
          <PiAuthFields
            key={`pi-auth-${piRepoId || 'all'}`}
            maskedApiKey={piMasked}
            savedEnvVar={piSavedEnvVar}
            envVarOptions={piEnvVarOptions}
            repoId={piRepoId || null}
            perRepoHint
            onChange={(patch, hasChanges) => setPiChange({ patch, hasChanges })}
          />
          <AgentSdkModelsSection
            key={`pi-models-${piRepoId || 'all'}-${piMasked ? '1' : '0'}`}
            sdk="pi"
            credentialConfigured={Boolean(piMasked)}
          />
          <SettingsSaveRow
            saving={piSaving}
            saved={piSaved}
            onSave={handleSavePi}
            disabled={!piChange.hasChanges}
          />
        </SettingsSection>
      </div>
    </div>
  );
}
