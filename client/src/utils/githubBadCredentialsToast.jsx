import { X } from 'lucide-react';
import toast from 'react-hot-toast';

const TOAST_ID = 'github-bad-credentials';

function authHref(path, redirectTo) {
  const base = redirectTo ? `${path}?redirectTo=${encodeURIComponent(redirectTo)}` : path;
  return base;
}

function GitHubBadCredentialsToast({ t, redirectTo }) {
  const reauthHref = authHref('/auth/github', redirectTo);
  const installHref = authHref('/auth/github/install', redirectTo);

  return (
    <div
      className={`bg-control border border-brand/60 rounded-xl px-4 py-3 shadow-lg w-full max-w-md transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-fg text-sm font-medium">GitHub authentication failed</p>
          <p className="text-xs text-fg-muted mt-1">
            GitHub rejected your credentials. Re-authenticate or verify that the Baguette GitHub App
            is installed and configured for your account.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <a
              href={reauthHref}
              className="inline-flex items-center text-xs text-on-brand bg-brand hover:bg-brand-hover rounded-lg px-2.5 py-1.5 transition-colors"
            >
              Re-authenticate with GitHub
            </a>
            <a
              href={installHref}
              className="inline-flex items-center text-xs text-heading bg-control-hover hover:bg-track rounded-lg px-2.5 py-1.5 transition-colors"
            >
              GitHub App settings
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={() => toast.dismiss(t.id)}
          className="text-faint hover:text-secondary shrink-0 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Shown when the server detects GitHub 401 Bad credentials on an API call. */
export function showGitHubBadCredentialsToast(redirectTo) {
  toast.custom((t) => <GitHubBadCredentialsToast t={t} redirectTo={redirectTo} />, {
    id: TOAST_ID,
    duration: 12_000,
  });
}
