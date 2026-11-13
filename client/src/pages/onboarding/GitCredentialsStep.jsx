import { useState } from 'react';
import { usersService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import TextInput from '../../components/TextInput.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';

function GithubCredentialStatus({ githubLinked }) {
  if (githubLinked) {
    return <p className="text-sm text-success">GitHub account linked.</p>;
  }
  return (
    <p className="text-xs text-faint">
      No GitHub App on this instance. Use a personal access token, or create an App from Admin
      later.
    </p>
  );
}

export default function GitCredentialsStep({ user, onPatSaved, onContinue, onBack, showBack }) {
  const [pat, setPat] = useState('');
  const [patSaving, setPatSaving] = useState(false);
  const githubLinked = Boolean(user?.github_linked);

  const handleSavePat = async () => {
    if (!user?.id || !pat.trim()) return;
    setPatSaving(true);
    try {
      await usersService.patch(user.id, { github_token: pat.trim() });
      setPat('');
      onPatSaved?.();
    } catch (err) {
      toastError('Failed to save GitHub token', err);
    } finally {
      setPatSaving(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-2">Git credentials</h1>
      <p className="text-fg-muted text-sm mb-6">
        Optional. Add a personal access token so Baguette can list GitHub repositories without a
        GitHub App. You can skip this and configure a token later in Settings → Repositories.
      </p>

      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-secondary mb-2">GitHub</p>
          <GithubCredentialStatus githubLinked={githubLinked} />
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary">
            GitHub personal access token <span className="text-faint font-normal">(optional)</span>
            <TextInput
              className="mt-1 font-mono"
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className={`${GHOST_BUTTON_CLASS} mt-2`}
            onClick={handleSavePat}
            disabled={patSaving || !pat.trim()}
          >
            {patSaving ? 'Saving…' : 'Save token'}
          </button>
        </div>
      </div>

      <div className={`mt-8 flex gap-2 ${showBack ? 'justify-between' : 'justify-end'}`}>
        {showBack ? (
          <button type="button" className={GHOST_BUTTON_CLASS} onClick={onBack}>
            Back
          </button>
        ) : null}
        <button type="button" className={PRIMARY_BUTTON_SIZED} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
