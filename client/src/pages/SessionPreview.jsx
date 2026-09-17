import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

export default function SessionPreview() {
  const [searchParams] = useSearchParams();
  const shortId = searchParams.get('session');
  const service = searchParams.get('service');
  const [status, setStatus] = useState('loading'); // 'loading' | 'redirecting' | 401 | 403 | 404 | 'error'

  useEffect(() => {
    if (!shortId) {
      setStatus('error');
      return;
    }

    const params = new URLSearchParams({ session: shortId });
    if (service) params.set('service', service);
    fetch(`/auth/preview?${params}`, {
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (res.ok) {
          const { url } = await res.json();
          setStatus('redirecting');
          window.location.href = url;
        } else {
          setStatus(res.status);
        }
      })
      .catch(() => setStatus('error'));
  }, [shortId, service]);

  if (status === 'loading' || status === 'redirecting') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  const redirectTo = `/preview?session=${shortId}`;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="bg-zinc-900 rounded-xl p-8 text-center max-w-md">
        {status === 401 ? (
          <>
            <h2 className="text-xl font-semibold text-white mb-2">Sign in required</h2>
            <p className="text-zinc-400 mb-6">You need to sign in to access this preview.</p>
            <div className="flex gap-3 justify-center">
              <a
                href={`/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
                className="px-4 py-2 bg-white text-zinc-900 rounded-lg font-medium text-sm hover:bg-zinc-100 transition-colors"
              >
                Sign in with GitHub
              </a>
            </div>
          </>
        ) : status === 403 ? (
          <>
            <h2 className="text-xl font-semibold text-white mb-2">Access denied</h2>
            <p className="text-zinc-400 mb-6">You don&apos;t have access to this preview.</p>
            <Link
              to="/"
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg font-medium text-sm hover:bg-zinc-700 transition-colors"
            >
              Go back to sessions
            </Link>
          </>
        ) : status === 404 ? (
          <>
            <h2 className="text-xl font-semibold text-white mb-2">Session not found</h2>
            <p className="text-zinc-400 mb-6">This session no longer exists or has been deleted.</p>
            <Link
              to="/"
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg font-medium text-sm hover:bg-zinc-700 transition-colors"
            >
              Go back to sessions
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-white mb-2">Something went wrong</h2>
            <p className="text-zinc-400 mb-6">Unable to access this preview.</p>
            <Link
              to="/"
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg font-medium text-sm hover:bg-zinc-700 transition-colors"
            >
              Go back
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
