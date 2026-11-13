import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { usersService } from '../../feathers.js';
import { apiFetch } from '../../api.js';
import { toastError } from '../../utils/toastError.jsx';
import { PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';

function formatPasskeyCreatedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function passkeyLabel(row) {
  const device = row.device_type || 'Passkey';
  const created = formatPasskeyCreatedAt(row.created_at);
  if (!created) return device;
  return `${device} · ${created}`;
}

export default function AccountSettingsTab({ settings, refreshAuth }) {
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const loadPasskeys = useCallback(() => {
    setLoading(true);
    return usersService
      .passkeyList()
      .then((rows) => setPasskeys(Array.isArray(rows) ? rows : []))
      .catch((err) => toastError('Failed to load passkeys', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPasskeys();
  }, [loadPasskeys]);

  const handleRegisterPasskey = async () => {
    setRegisterBusy(true);
    try {
      const username = settings?.username || '';
      const optionsJSON = await apiFetch('/auth/passkey/register/options', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      const credential = await startRegistration({ optionsJSON });
      await apiFetch('/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify({ ...credential, username }),
      });
      loadPasskeys();
      await refreshAuth?.();
    } catch (err) {
      toastError('Failed to register passkey', err);
    } finally {
      setRegisterBusy(false);
    }
  };

  const handleRemovePasskey = async (row) => {
    setRemovingId(row.id);
    try {
      await usersService.passkeyRemove({ id: row.id });
      setPasskeys((prev) => prev.filter((item) => item.id !== row.id));
      await refreshAuth?.();
    } catch (err) {
      toastError('Failed to remove passkey', err);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div>
      <SettingsTabHeader title="Account">Passkeys for signing in without GitHub.</SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Passkeys"
          description="Register a passkey on this device or remove ones you no longer use."
        >
          {loading ? (
            <p className="text-faint text-sm">Loading…</p>
          ) : passkeys.length === 0 ? (
            <p className="text-faint text-sm">No passkeys registered.</p>
          ) : (
            <div className="divide-y divide-line">
              {passkeys.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <p className="text-sm text-fg min-w-0 truncate">{passkeyLabel(row)}</p>
                  <button
                    type="button"
                    onClick={() => handleRemovePasskey(row)}
                    disabled={removingId !== null}
                    className="text-xs text-danger hover:text-danger disabled:opacity-50 shrink-0"
                  >
                    {removingId === row.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className={`${PRIMARY_BUTTON_SIZED} gap-2`}
            onClick={handleRegisterPasskey}
            disabled={registerBusy}
          >
            <Fingerprint className="w-4 h-4" />
            {registerBusy ? 'Waiting for passkey…' : 'Register another passkey'}
          </button>
        </SettingsSection>
      </div>
    </div>
  );
}
