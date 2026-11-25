import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { toastError } from '../../utils/toastError.jsx';
import { publicStorageService } from '../../feathers.js';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';
import TextInput from '../../components/TextInput.jsx';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import { PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import {
  buildPublicStorageTestPayload,
  canTestPublicStorageConnection,
} from '../../utils/publicStorageTestPayload.js';

const EMPTY_FORM = {
  endpoint_url: '',
  bucket: '',
  region: '',
  access_key_id: '',
  public_base_url: '',
};

export default function PublicStorageTab() {
  const [loaded, setLoaded] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [secretDirty, setSecretDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [grooming, setGrooming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const secretConfigured = Boolean(loaded?.secret_configured);
  const configured = Boolean(loaded?.configured);

  const load = useCallback(() => {
    publicStorageService
      .get(1)
      .then((row) => {
        setLoaded(row);
        setForm({
          endpoint_url: row.endpoint_url ?? '',
          bucket: row.bucket ?? '',
          region: row.region ?? '',
          access_key_id: row.access_key_id ?? '',
          public_base_url: row.public_base_url ?? '',
        });
        setSecretAccessKey('');
        setSecretDirty(false);
      })
      .catch((err) => toastError('Failed to load public storage', err));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        endpoint_url: form.endpoint_url.trim(),
        bucket: form.bucket.trim(),
        region: form.region.trim(),
        access_key_id: form.access_key_id.trim(),
        public_base_url: form.public_base_url.trim(),
      };
      if (secretDirty) payload.secret_access_key = secretAccessKey ?? '';
      await publicStorageService.patch(1, payload);
      toast.success('Public storage saved');
      load();
    } catch (err) {
      toastError('Failed to save public storage', err);
    } finally {
      setSaving(false);
    }
  };

  const canTest = canTestPublicStorageConnection(
    form,
    secretAccessKey,
    secretConfigured,
    secretDirty
  );

  const handleTest = async () => {
    setTesting(true);
    try {
      const payload = buildPublicStorageTestPayload(
        form,
        secretAccessKey,
        secretConfigured,
        secretDirty
      );
      await publicStorageService.test(payload);
      toast.success('Connection test succeeded');
    } catch (err) {
      toastError('Public storage test failed', err);
    } finally {
      setTesting(false);
    }
  };

  const handleGroom = async () => {
    setGrooming(true);
    try {
      const result = await publicStorageService.groom(1);
      const deleted = result?.deleted ?? 0;
      toast.success(deleted === 1 ? 'Removed 1 unused image' : `Removed ${deleted} unused images`);
    } catch (err) {
      toastError('Failed to remove unused images', err);
    } finally {
      setGrooming(false);
    }
  };

  const handleClear = async () => {
    if (
      !window.confirm(
        'Clear public storage configuration? Images will stop uploading to the bucket.'
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await publicStorageService.remove(1);
      toast.success('Public storage cleared');
      load();
    } catch (err) {
      toastError('Failed to clear public storage', err);
    } finally {
      setClearing(false);
    }
  };

  if (!loaded) return <p className="text-faint">Loading…</p>;

  const secretMasked = secretConfigured ? 'saved' : null;

  return (
    <div>
      <SettingsTabHeader title="Public storage">
        For Baguette instances that GitHub cannot reach (VPN, tunnel, private network). When
        configured, images embedded in the session description are uploaded to your bucket and the
        public URL is inserted in the pull request. The bucket must allow anonymous read of those
        objects. See <code className="text-secondary">docs/public-object-storage.md</code> for setup
        details.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Status"
          description={
            configured
              ? 'Public storage is configured. Session description sync uploads images to the bucket.'
              : canTest
                ? 'Settings are complete in the form but not saved yet — save to enable bucket uploads on PR sync.'
                : 'Not configured — PR bodies use instance image URLs or GitHub attachments when available.'
          }
        >
          <p className="text-sm text-fg">
            {configured ? (
              <span className="text-success font-medium">Configured</span>
            ) : canTest ? (
              <span className="text-secondary font-medium">Not configured — save required</span>
            ) : (
              <span className="text-faint">Not configured</span>
            )}
          </p>
        </SettingsSection>

        <SettingsSection
          title="S3-compatible storage"
          description="Credentials are encrypted at rest and are never returned to the browser."
        >
          <form onSubmit={handleSave} className="space-y-4">
            <label className="block text-sm font-medium text-secondary">
              Endpoint URL
              <TextInput
                className="mt-1 w-full font-mono text-sm"
                value={form.endpoint_url}
                onChange={setField('endpoint_url')}
                placeholder="https://s3.eu-west-1.amazonaws.com"
                autoComplete="off"
              />
              <span className="mt-1 block text-xs text-faint">
                S3 API host. Uploads use path-style addressing (MinIO, R2, and S3).
              </span>
            </label>

            <label className="block text-sm font-medium text-secondary">
              Bucket name
              <TextInput
                className="mt-1 w-full font-mono text-sm"
                value={form.bucket}
                onChange={setField('bucket')}
                placeholder="my-baguette-images"
                autoComplete="off"
              />
            </label>

            <label className="block text-sm font-medium text-secondary">
              Region <span className="text-faint font-normal">(optional)</span>
              <TextInput
                className="mt-1 w-full font-mono text-sm"
                value={form.region}
                onChange={setField('region')}
                placeholder="us-east-1"
                autoComplete="off"
              />
            </label>

            <label className="block text-sm font-medium text-secondary">
              Access key id <span className="text-faint font-normal">(optional)</span>
              <TextInput
                className="mt-1 w-full font-mono text-sm"
                value={form.access_key_id}
                onChange={setField('access_key_id')}
                autoComplete="off"
              />
              <span className="mt-1 block text-xs text-faint">
                Leave blank on EC2 (or ECS/EKS) to use the instance task IAM role instead of static
                keys.
              </span>
            </label>

            <label className="block text-sm font-medium text-secondary">
              Secret access key <span className="text-faint font-normal">(optional)</span>
              <div className="mt-1">
                <MaskedSecretInput
                  maskedValue={secretMasked}
                  placeholder="Secret access key"
                  onChange={(val, dirty) => {
                    setSecretAccessKey(val ?? '');
                    setSecretDirty(dirty);
                  }}
                />
              </div>
            </label>

            <label className="block text-sm font-medium text-secondary">
              Public base URL
              <TextInput
                className="mt-1 w-full font-mono text-sm"
                value={form.public_base_url}
                onChange={setField('public_base_url')}
                placeholder="https://images.example.com"
                autoComplete="off"
              />
              <span className="mt-1 block text-xs text-faint">
                Origin where anonymous clients read uploaded objects (CDN or bucket website).
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={PRIMARY_BUTTON_SIZED} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="text-sm text-secondary hover:text-fg disabled:text-faint px-3 py-2"
                onClick={handleTest}
                disabled={testing || !canTest}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                className="text-sm text-secondary hover:text-fg disabled:text-faint px-3 py-2"
                onClick={handleGroom}
                disabled={grooming}
              >
                {grooming ? 'Removing…' : 'Remove unused images'}
              </button>
              {configured && (
                <button
                  type="button"
                  className="text-sm text-danger hover:text-danger px-3 py-2 disabled:text-faint"
                  onClick={handleClear}
                  disabled={clearing}
                >
                  {clearing ? 'Clearing…' : 'Clear configuration'}
                </button>
              )}
            </div>
          </form>
        </SettingsSection>
      </div>
    </div>
  );
}
