import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { decrypt } from '../encrypt.js';
import {
  buildGithubAppManifest,
  buildGithubManifestPayload,
  convertGithubAppManifest,
  conversionIncludesManifestState,
  persistGithubAppConversion,
  githubAppManifestFormUrl,
  githubAppDisplayName,
} from '../github-app-manifest.js';
import { getGithubAppConfig, invalidateGithubAppCache } from '../instance-settings.js';

vi.mock('../config.js', () => ({
  PUBLIC_HOST: 'http://localhost:5173',
  ENCRYPTION_KEY: 'test-encryption-key-at-least-32-chars',
}));

const db = createTestDb();

describe('buildGithubAppManifest', () => {
  it('includes permissions, OAuth URLs, name, request_oauth_on_install, and no hook_attributes', () => {
    const manifest = buildGithubAppManifest('http://localhost:5173');

    expect(manifest.name).toBe('Baguette (localhost)');
    expect(manifest.url).toBe('http://localhost:5173');
    expect(manifest.redirect_url).toBe('http://localhost:5173/auth/github/manifest/callback');
    expect(manifest.callback_urls).toEqual(['http://localhost:5173/auth/github/callback']);
    expect(manifest.setup_url).toBe('http://localhost:5173/auth/github/callback');
    expect(manifest.public).toBe(false);
    expect(manifest.request_oauth_on_install).toBe(true);
    expect(manifest.default_permissions).toEqual({
      metadata: 'read',
      contents: 'write',
      pull_requests: 'write',
      issues: 'write',
      actions: 'read',
      workflows: 'write',
      emails: 'read',
    });
    expect(manifest.hook_attributes).toBeUndefined();
    expect(manifest).not.toHaveProperty('expire_user_authorization_tokens');
  });

  it('embeds CSRF state on homepage url, not redirect_url (GitHub rejects query strings there)', () => {
    const manifest = buildGithubAppManifest('http://localhost:5173', { state: 'abc123' });
    expect(manifest.url).toBe('http://localhost:5173/?github_manifest_state=abc123');
    expect(manifest.redirect_url).toBe('http://localhost:5173/auth/github/manifest/callback');
  });

  it('truncates long hostnames to GitHub app name limit', () => {
    const longHost = 'http://' + 'a'.repeat(40) + '.example.com';
    expect(githubAppDisplayName(longHost).length).toBeLessThanOrEqual(34);
    expect(githubAppDisplayName(longHost)).toMatch(/^Baguette \(/);
  });
});

describe('githubAppManifestFormUrl', () => {
  it('uses org settings URL for a safe org slug', () => {
    expect(githubAppManifestFormUrl('my-org')).toBe(
      'https://github.com/organizations/my-org/settings/apps/new'
    );
  });

  it('ignores invalid org slugs and uses personal settings URL', () => {
    expect(githubAppManifestFormUrl('bad org!')).toBe('https://github.com/settings/apps/new');
    expect(buildGithubManifestPayload({ org: '../evil' }).github_form_url).toBe(
      'https://github.com/settings/apps/new'
    );
  });
});

describe('persistGithubAppConversion', () => {
  it('encrypts secrets and invalidates cache so getGithubAppConfig sees new values', async () => {
    invalidateGithubAppCache();
    expect((await getGithubAppConfig(db)).configured).toBe(false);

    await persistGithubAppConversion(db, {
      id: 99,
      slug: 'baguette-dev',
      client_id: 'cid-new',
      client_secret: 'secret-new',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
      webhook_secret: 'whsec',
    });

    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.github_app_id).toBe(99);
    expect(row.github_app_slug).toBe('baguette-dev');
    expect(row.github_app_client_id).toBe('cid-new');
    expect(decrypt(row.github_app_client_secret_encrypted)).toBe('secret-new');
    expect(decrypt(row.github_app_private_key_encrypted)).toContain('BEGIN RSA');
    expect(decrypt(row.github_app_webhook_secret_encrypted)).toBe('whsec');

    const config = await getGithubAppConfig(db);
    expect(config.configured).toBe(true);
    expect(config.client_id).toBe('cid-new');
    expect(config.client_secret).toBe('secret-new');
    expect(config.slug).toBe('baguette-dev');
    expect(config.app_id).toBe(99);
  });
});

describe('conversionIncludesManifestState', () => {
  it('matches the nonce echoed on conversion.external_url', () => {
    expect(
      conversionIncludesManifestState(
        { external_url: 'http://localhost:5173/?github_manifest_state=nonce-1' },
        'nonce-1'
      )
    ).toBe(true);
    expect(
      conversionIncludesManifestState(
        { external_url: 'http://localhost:5173/?github_manifest_state=other' },
        'nonce-1'
      )
    ).toBe(false);
    expect(
      conversionIncludesManifestState({ external_url: 'http://localhost:5173/' }, 'nonce-1')
    ).toBe(false);
    expect(conversionIncludesManifestState({}, 'nonce-1')).toBe(false);
  });
});

describe('convertGithubAppManifest', () => {
  it('POSTs to GitHub manifest conversions API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, slug: 'x' }),
    });

    const result = await convertGithubAppManifest('temp-code', { fetchImpl });

    expect(result.slug).toBe('x');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/app-manifests/temp-code/conversions',
      expect.objectContaining({
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json' },
      })
    );
  });

  it('throws when conversion fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422 });
    await expect(convertGithubAppManifest('bad', { fetchImpl })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe('unconfigured instance_settings', () => {
  it('reports configured false for the boot-seeded empty row', async () => {
    invalidateGithubAppCache();
    const config = await getGithubAppConfig(db);
    expect(config.configured).toBe(false);
    expect(config.client_id).toBeNull();
  });
});
