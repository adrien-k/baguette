import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import GithubIcon from '../components/svg/GithubIcon.jsx';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';
import TextInput from '../components/TextInput.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { apiFetch } from '../api.js';
import { toastError } from '../utils/toastError.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { loginMode, showPasskeySignIn } from '../utils/authMe.js';

function withRedirectTo(path, redirectTo) {
  if (!redirectTo) return path;
  return `${path}?redirectTo=${encodeURIComponent(redirectTo)}`;
}

function DevSignInLink({ redirectTo }) {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="mt-4 pt-4 border-t border-line">
      <a
        href={withRedirectTo('/auth/dev', redirectTo)}
        className="inline-flex items-center gap-2 text-fg-muted hover:text-heading text-sm transition-colors"
      >
        <span className="text-xs bg-control px-1.5 py-0.5 rounded font-mono">DEV</span>
        Sign in as dev@baguette.local
      </a>
    </div>
  );
}

function PasskeyButton({ onClick, busy, primary }) {
  const className = primary
    ? `${PRIMARY_BUTTON_SIZED} w-full gap-2`
    : `${GHOST_BUTTON_CLASS} w-full inline-flex items-center justify-center gap-2`;
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      <Fingerprint className="w-4 h-4" />
      {busy ? 'Waiting for passkey…' : 'Sign in with passkey'}
    </button>
  );
}

function GithubSignInButton({ redirectTo }) {
  return (
    <a
      href={withRedirectTo('/auth/github', redirectTo)}
      className="inline-flex items-center justify-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200 transition-colors w-full"
    >
      <GithubIcon className="w-5 h-5" />
      Sign in with GitHub
    </a>
  );
}

function LoginShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-page flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-brand/[0.06] rounded-full blur-3xl" />
      </div>

      <div className="bg-nav rounded-2xl p-10 text-center max-w-sm w-full shadow-2xl border border-line relative">
        <BaguetteIcon className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-fg mb-2 font-display">{title}</h1>
        {subtitle ? <p className="text-fg-muted mb-8 text-sm">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');
  const navigate = useNavigate();
  const { github, bootstrap, passkeys, setUser, refreshAuth } = useAuth();
  const [password, setPassword] = useState('');
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const mode = loginMode(bootstrap, github);
  const passkeySignIn = showPasskeySignIn(passkeys);

  const applyUserAndGo = (user) => {
    if (user) setUser(user);
    if (!user?.onboarding_completed) {
      navigate('/onboarding');
      return;
    }
    navigate('/');
  };

  const handleBootstrap = async (event) => {
    event.preventDefault();
    setBootstrapBusy(true);
    try {
      const body = bootstrap?.password_required ? { password } : {};
      const data = await apiFetch('/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      try {
        const me = await refreshAuth();
        applyUserAndGo(me.user || data.user);
      } catch {
        applyUserAndGo(data.user);
      }
    } catch (err) {
      toastError('Failed to set up this Baguette', err);
    } finally {
      setBootstrapBusy(false);
    }
  };

  const handlePasskey = async () => {
    setPasskeyBusy(true);
    try {
      const optionsJSON = await apiFetch('/auth/passkey/options', { method: 'POST' });
      const assertion = await startAuthentication({ optionsJSON });
      const data = await apiFetch('/auth/passkey/verify', {
        method: 'POST',
        body: JSON.stringify(assertion),
      });
      try {
        const me = await refreshAuth();
        applyUserAndGo(me.user || data.user);
      } catch {
        applyUserAndGo(data.user);
      }
    } catch (err) {
      toastError('Failed to sign in with passkey', err);
    } finally {
      setPasskeyBusy(false);
    }
  };

  if (mode === 'bootstrap') {
    return (
      <LoginShell
        title="Set up this Baguette"
        subtitle="Create the first admin account for this instance."
      >
        <form onSubmit={handleBootstrap} className="flex flex-col gap-3 text-left">
          {bootstrap?.password_required ? (
            <label className="block text-sm font-medium text-secondary">
              Bootstrap password
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="mt-1"
              />
            </label>
          ) : null}
          <button
            type="submit"
            className={`${PRIMARY_BUTTON_SIZED} w-full`}
            disabled={bootstrapBusy}
          >
            {bootstrapBusy ? 'Setting up…' : 'Continue'}
          </button>
        </form>
        <DevSignInLink redirectTo={redirectTo} />
      </LoginShell>
    );
  }

  if (mode === 'github') {
    return (
      <LoginShell title="Baguette" subtitle="AI-powered coding sessions">
        <div className="flex flex-col gap-3">
          <GithubSignInButton redirectTo={redirectTo} />
          {passkeySignIn ? <PasskeyButton onClick={handlePasskey} busy={passkeyBusy} /> : null}
        </div>
        <DevSignInLink redirectTo={redirectTo} />
      </LoginShell>
    );
  }

  return (
    <LoginShell title="Baguette" subtitle="AI-powered coding sessions">
      {passkeySignIn ? (
        <div className="flex flex-col gap-3">
          <PasskeyButton onClick={handlePasskey} busy={passkeyBusy} primary />
        </div>
      ) : null}
      <p className={`text-xs text-faint ${passkeySignIn ? 'mt-6' : ''}`}>
        Ask an admin for an invite link to create an account. They can add GitHub sign-in later from{' '}
        <span className="text-secondary">Admin → GitHub App</span>.
      </p>
      <DevSignInLink redirectTo={redirectTo} />
    </LoginShell>
  );
}
