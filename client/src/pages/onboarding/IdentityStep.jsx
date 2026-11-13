import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { usersService } from '../../feathers.js';
import { apiFetch } from '../../api.js';
import { toastError } from '../../utils/toastError.jsx';
import TextInput from '../../components/TextInput.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { canContinueIdentityStep } from '../../utils/onboardingSteps.js';

function passkeyButtonLabel(busy, passkeyCount) {
  if (busy) return 'Waiting for passkey…';
  if (passkeyCount >= 1) return 'Register another passkey';
  return 'Register passkey';
}

function passkeyStatusText(passkeyCount) {
  if (passkeyCount === 1) return '1 passkey registered.';
  return `${passkeyCount} passkeys registered.`;
}

function passkeyHint(passkeyCount) {
  if (passkeyCount >= 1) return null;
  return 'Required. Register a passkey to continue.';
}

export default function IdentityStep({ user, refreshAuth, onContinue, onBack, showBack }) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [continuing, setContinuing] = useState(false);

  const handleRegisterPasskey = async () => {
    setPasskeyBusy(true);
    try {
      const name = username.trim();
      const optionsJSON = await apiFetch('/auth/passkey/register/options', {
        method: 'POST',
        body: JSON.stringify({ username: name }),
      });
      const credential = await startRegistration({ optionsJSON });
      await apiFetch('/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify({ ...credential, username: name }),
      });
      await refreshAuth();
    } catch (err) {
      toastError('Failed to register passkey', err);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const canContinue = canContinueIdentityStep(user);

  const handleContinue = async () => {
    if (!canContinue) return;
    setContinuing(true);
    try {
      const name = username.trim();
      if (user?.id && name && name !== user.username) {
        await usersService.patch(user.id, { username: name });
        await refreshAuth();
      }
      onContinue();
    } catch (err) {
      toastError('Failed to save username', err);
    } finally {
      setContinuing(false);
    }
  };

  const passkeyCount = Number(user?.passkey_count) || 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-2">Set up your identity</h1>
      <p className="text-fg-muted text-sm mb-6">
        Choose a username and a passkey to sign in to Baguette. A GitHub personal access token is
        optional on the next step.
      </p>

      <div className="space-y-6">
        <label className="block text-sm font-medium text-secondary">
          Username
          <TextInput
            className="mt-1"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>

        <div>
          <p className="text-sm font-medium text-secondary mb-2">Passkey</p>
          {passkeyCount >= 1 ? (
            <p className="text-sm text-success mb-2">{passkeyStatusText(passkeyCount)}</p>
          ) : (
            <p className="text-xs text-faint mb-2">{passkeyHint(passkeyCount)}</p>
          )}
          <button
            type="button"
            className={`${PRIMARY_BUTTON_SIZED} gap-2`}
            onClick={handleRegisterPasskey}
            disabled={passkeyBusy}
          >
            <Fingerprint className="w-4 h-4" />
            {passkeyButtonLabel(passkeyBusy, passkeyCount)}
          </button>
        </div>
      </div>

      <div className={`mt-8 flex gap-2 ${showBack ? 'justify-between' : 'justify-end'}`}>
        {showBack ? (
          <button type="button" className={GHOST_BUTTON_CLASS} onClick={onBack}>
            Back
          </button>
        ) : null}
        <button
          type="button"
          className={PRIMARY_BUTTON_SIZED}
          onClick={handleContinue}
          disabled={!canContinue || continuing}
        >
          {continuing ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
