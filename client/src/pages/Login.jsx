import GithubIcon from '../components/svg/GithubIcon.jsx';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';
import { useSearchParams } from 'react-router-dom';

function withRedirectTo(path, redirectTo) {
  if (!redirectTo) return path;
  return `${path}?redirectTo=${encodeURIComponent(redirectTo)}`;
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');

  return (
    <div className="min-h-screen bg-page flex items-center justify-center relative overflow-hidden">
      {/* Atmospheric glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-brand/[0.06] rounded-full blur-3xl" />
      </div>

      <div className="bg-nav rounded-2xl p-10 text-center max-w-sm w-full shadow-2xl border border-line relative">
        <BaguetteIcon className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-fg mb-2 font-display">Baguette</h1>
        <p className="text-fg-muted mb-8 text-sm">AI-powered coding sessions</p>
        <a
          href={withRedirectTo('/auth/github', redirectTo)}
          className="inline-flex items-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200 transition-colors"
        >
          <GithubIcon className="w-5 h-5" />
          Sign in with GitHub
        </a>
        {import.meta.env.DEV && (
          <div className="mt-4 pt-4 border-t border-line">
            <a
              href={withRedirectTo('/auth/dev', redirectTo)}
              className="inline-flex items-center gap-2 text-fg-muted hover:text-heading text-sm transition-colors"
            >
              <span className="text-xs bg-control px-1.5 py-0.5 rounded font-mono">DEV</span>
              Sign in as dev@baguette.local
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
