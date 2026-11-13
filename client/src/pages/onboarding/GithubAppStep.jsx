import { useState } from 'react';
import TextInput from '../../components/TextInput.jsx';
import { apiFetch } from '../../api.js';
import { toastError } from '../../utils/toastError.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { submitGithubManifestForm } from './submitGithubManifest.js';

export default function GithubAppStep({ onSkip }) {
  const [org, setOrg] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const params = new URLSearchParams({ return_to: '/onboarding' });
      const slug = org.trim();
      if (slug) params.set('org', slug);
      const payload = await apiFetch(`/auth/github/manifest?${params}`);
      submitGithubManifestForm(payload.github_form_url, payload.manifest);
    } catch (err) {
      toastError('Failed to start GitHub App creation', err);
      setCreating(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-2">Create a GitHub App</h1>
      <p className="text-fg-muted text-sm mb-6">
        A GitHub App lets people sign in with GitHub and pick repositories. You confirm the app on
        GitHub; Baguette stores the credentials. The next step is signing in with GitHub. Skip to
        set a username and passkey instead.
      </p>
      <label className="block text-sm font-medium text-secondary mb-6">
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
      <div className="flex justify-between gap-2">
        <button type="button" className={GHOST_BUTTON_CLASS} onClick={onSkip}>
          Skip
        </button>
        <button
          type="button"
          className={PRIMARY_BUTTON_SIZED}
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? 'Redirecting…' : 'Create GitHub App'}
        </button>
      </div>
    </div>
  );
}
