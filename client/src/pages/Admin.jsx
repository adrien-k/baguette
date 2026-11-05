import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Users, GitBranch, KeyRound, MessageSquare } from 'lucide-react';
import { toastError } from '../utils/toastError.jsx';
import { instanceSettingsService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { apiFetch } from '../api.js';
import { submitGithubManifestForm } from './onboarding/submitGithubManifest.js';
import {
  SecretsTab,
  UsersTab,
  SlackTab,
  AllRepositoriesSection,
} from './settings/GlobalSettingsSections.jsx';
import { SettingsSection, SettingsTabHeader } from '../components/SettingsSection.jsx';
import TextInput from '../components/TextInput.jsx';
import GithubIcon from '../components/svg/GithubIcon.jsx';
import { PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'repos', label: 'Repositories', icon: GitBranch },
  { id: 'github', label: 'GitHub App', icon: GithubIcon },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'slack', label: 'Slack', icon: MessageSquare },
];

const DEFAULT_TAB = TABS[0].id;

const ADMIN_MANIFEST_RETURN_TO = '/admin?tab=github';

async function startGithubManifest(org) {
  const params = new URLSearchParams({ return_to: ADMIN_MANIFEST_RETURN_TO });
  const slug = org.trim();
  if (slug) params.set('org', slug);
  const payload = await apiFetch(`/auth/github/manifest?${params}`);
  submitGithubManifestForm(payload.github_form_url, payload.manifest);
}

function GithubAppTab() {
  const [info, setInfo] = useState(null);
  const [org, setOrg] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    instanceSettingsService
      .get(1)
      .then(setInfo)
      .catch((err) => toastError('Failed to load GitHub App settings', err));
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await startGithubManifest(org);
    } catch (err) {
      toastError('Failed to start GitHub App creation', err);
      setCreating(false);
    }
  };

  if (!info) return <p className="text-faint">Loading…</p>;

  const createLabel = info.configured ? 'Recreate GitHub App' : 'Create GitHub App';

  return (
    <div>
      <SettingsTabHeader title="GitHub App">
        Sign-in with GitHub and repository pickers need a GitHub App. Credentials are stored on this
        instance; secrets are never shown here.
      </SettingsTabHeader>

      <div className="space-y-6">
        {info.configured ? (
          <SettingsSection
            title="Configured"
            description="This instance already has a GitHub App. Recreating it via the manifest flow updates the same settings row."
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-faint">Slug</dt>
              <dd className="text-fg font-mono">{info.slug || '—'}</dd>
              <dt className="text-faint">App ID</dt>
              <dd className="text-fg font-mono">{info.app_id || '—'}</dd>
              <dt className="text-faint">Client ID</dt>
              <dd className="text-fg font-mono">{info.client_id || '—'}</dd>
            </dl>
          </SettingsSection>
        ) : (
          <SettingsSection
            title="Not configured"
            description="You can leave the GitHub App unconfigured and keep using passkeys or a personal access token."
          >
            <p className="text-sm text-faint">
              Creating an app takes you to GitHub to confirm the manifest. Baguette stores the
              credentials when GitHub redirects back.
            </p>
          </SettingsSection>
        )}

        <SettingsSection
          title={info.configured ? 'Recreate' : 'Create'}
          description="Optional organization slug. Leave empty to create the app on your personal GitHub account."
        >
          <label className="block text-sm font-medium text-secondary">
            Organization slug <span className="text-faint font-normal">(optional)</span>
            <TextInput
              className="mt-1"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="acme-corp"
              autoComplete="off"
            />
            <span className="mt-1 block text-xs text-faint">
              Leave empty to create the app on your personal GitHub account.
            </span>
          </label>
          <button
            type="button"
            className={PRIMARY_BUTTON_SIZED}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'Redirecting…' : createLabel}
          </button>
        </SettingsSection>
      </div>
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || DEFAULT_TAB;
  const activeTab = TABS.some((t) => t.id === rawTab) ? rawTab : DEFAULT_TAB;

  const setTab = (tab) => setSearchParams({ tab });

  if (!user?.admin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-bold text-fg mb-4 sm:mb-6">Admin</h1>

      <div className="flex flex-col sm:flex-row sm:items-start gap-6">
        <nav className="sm:w-52 shrink-0 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-control-hover text-fg'
                    : 'text-faint hover:text-heading hover:bg-inset'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent' : 'text-faint'}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'repos' && <AllRepositoriesSection />}
          {activeTab === 'github' && <GithubAppTab />}
          {activeTab === 'secrets' && <SecretsTab scope="global" />}
          {activeTab === 'slack' && <SlackTab />}
        </div>
      </div>
    </div>
  );
}
