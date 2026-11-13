import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import BaguetteIcon from '../components/svg/BaguetteIcon.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { apiFetch } from '../api.js';
import { toastError } from '../utils/toastError.jsx';
import { PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';

export default function Invite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setUser, refreshAuth } = useAuth();
  const [username, setUsername] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('This invite link is invalid or has already been used.');
      return;
    }
    let cancelled = false;
    apiFetch(`/auth/invite/${encodeURIComponent(token)}`)
      .then((data) => {
        if (cancelled) return;
        setUsername(data.username);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || 'This invite link is invalid or has already been used.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAddPasskey = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const optionsJSON = await apiFetch(`/auth/invite/${encodeURIComponent(token)}/options`, {
        method: 'POST',
      });
      const credential = await startRegistration({ optionsJSON });
      const data = await apiFetch(`/auth/invite/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        body: JSON.stringify(credential),
      });
      try {
        const me = await refreshAuth();
        if (me.user) setUser(me.user);
        else if (data.user) setUser(data.user);
      } catch {
        if (data.user) setUser(data.user);
      }
      navigate('/onboarding');
    } catch (err) {
      toastError('Failed to add passkey', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-brand/[0.06] rounded-full blur-3xl" />
      </div>

      <div className="bg-nav rounded-2xl p-10 text-center max-w-sm w-full shadow-2xl border border-line relative">
        <BaguetteIcon className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-fg mb-2 font-display">Join Baguette</h1>
        {loadError ? (
          <p className="text-fg-muted text-sm">{loadError}</p>
        ) : !username ? (
          <p className="text-fg-muted text-sm">Checking invite…</p>
        ) : (
          <>
            <p className="text-fg-muted mb-8 text-sm">
              Add a passkey for <span className="text-heading font-medium">{username}</span> to
              finish joining this instance.
            </p>
            <button
              type="button"
              onClick={handleAddPasskey}
              disabled={busy}
              className={`${PRIMARY_BUTTON_SIZED} w-full gap-2`}
            >
              <Fingerprint className="w-4 h-4" />
              {busy ? 'Waiting for passkey…' : 'Add passkey'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
