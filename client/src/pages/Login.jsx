import { useSearchParams } from 'react-router-dom';

function withRedirectTo(path, redirectTo) {
  if (!redirectTo) return path;
  return `${path}?redirectTo=${encodeURIComponent(redirectTo)}`;
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center relative overflow-hidden">
      {/* Atmospheric glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-amber-500/[0.06] rounded-full blur-3xl" />
      </div>

      <div className="bg-zinc-900 rounded-2xl p-10 text-center max-w-sm w-full shadow-2xl border border-zinc-800 relative">
        <img src="/baguette.svg" alt="" className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-white mb-2 font-display">Baguette</h1>
        <p className="text-zinc-400 mb-8 text-sm">AI-powered coding sessions</p>
        <a
          href={withRedirectTo('/auth/github', redirectTo)}
          className="inline-flex items-center gap-3 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Sign in with GitHub
        </a>
        {import.meta.env.DEV && (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <a
              href={withRedirectTo('/auth/dev', redirectTo)}
              className="inline-flex items-center gap-2 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
            >
              <span className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded font-mono">DEV</span>
              Sign in as dev@baguette.local
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
