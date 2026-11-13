import crypto from 'crypto';
import { PUBLIC_HOST } from '../config.js';
import { encrypt } from './encrypt.js';
import { invalidateGithubAppCache } from './instance-settings.js';

const GITHUB_PERSONAL_MANIFEST_URL = 'https://github.com/settings/apps/new';
const MANIFEST_CONVERSION_URL = 'https://api.github.com/app-manifests';

/** GitHub App names are limited to 34 characters. */
const GITHUB_APP_NAME_MAX_LEN = 34;

const MANIFEST_PERMISSIONS = {
  metadata: 'read',
  contents: 'write',
  pull_requests: 'write',
  issues: 'write',
  actions: 'read',
  workflows: 'write',
  // Account → Email addresses. The UI label is "email addresses"; GitHub's
  // manifest allowlist key is `emails` (not `email_addresses`).
  emails: 'read',
};

function safeGithubOrgSlug(org) {
  if (typeof org !== 'string' || !org) return null;
  if (!/^[a-zA-Z0-9-]+$/.test(org)) return null;
  return org;
}

export function githubAppManifestFormUrl(org) {
  const slug = safeGithubOrgSlug(org);
  if (slug) {
    return `https://github.com/organizations/${slug}/settings/apps/new`;
  }
  return GITHUB_PERSONAL_MANIFEST_URL;
}

export function githubAppDisplayName(publicHost = PUBLIC_HOST) {
  const hostname = new URL(publicHost).hostname;
  const full = `Baguette (${hostname})`;
  if (full.length <= GITHUB_APP_NAME_MAX_LEN) return full;
  const prefix = 'Baguette (';
  const suffix = ')';
  const maxHostLen = GITHUB_APP_NAME_MAX_LEN - prefix.length - suffix.length;
  return `${prefix}${hostname.slice(0, Math.max(0, maxHostLen))}${suffix}`;
}

export function createManifestState() {
  return crypto.randomBytes(16).toString('hex');
}

function withSearchParam(url, name, value) {
  const parsed = new URL(url);
  parsed.searchParams.set(name, value);
  return parsed.toString();
}

export function buildGithubAppManifest(publicHost = PUBLIC_HOST, { state } = {}) {
  const oauthCallback = new URL('/auth/github/callback', publicHost).toString();
  // GitHub rejects redirect_url with a query string ("redirect_url must be a valid URL").
  const redirectUrl = new URL('/auth/github/manifest/callback', publicHost).toString();
  const homepage = state ? withSearchParam(publicHost, MANIFEST_STATE_QUERY, state) : publicHost;

  return {
    name: githubAppDisplayName(publicHost),
    url: homepage,
    redirect_url: redirectUrl,
    callback_urls: [oauthCallback],
    setup_url: oauthCallback,
    public: false,
    request_oauth_on_install: true,
    default_permissions: { ...MANIFEST_PERMISSIONS },
  };
}

export function buildGithubManifestPayload({ org, state } = {}) {
  return {
    github_form_url: githubAppManifestFormUrl(org),
    manifest: buildGithubAppManifest(undefined, { state }),
  };
}

/** True when the GitHub conversion echoes the nonce we put on manifest.url. */
export function conversionIncludesManifestState(conversion, expectedState) {
  if (!expectedState || typeof expectedState !== 'string') return false;
  const externalUrl = typeof conversion?.external_url === 'string' ? conversion.external_url : '';
  try {
    return new URL(externalUrl).searchParams.get(MANIFEST_STATE_QUERY) === expectedState;
  } catch {
    return false;
  }
}

/**
 * @param {string} code Temporary manifest code from GitHub redirect
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function convertGithubAppManifest(code, { fetchImpl = fetch } = {}) {
  const url = `${MANIFEST_CONVERSION_URL}/${encodeURIComponent(code)}/conversions`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    const err = new Error(`GitHub manifest conversion failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Persist GitHub App credentials from a manifest conversion response into instance_settings id=1.
 * @param {import('knex').Knex} db
 * @param {Record<string, unknown>} conversion
 */
export async function persistGithubAppConversion(db, conversion) {
  const clientSecret =
    typeof conversion.client_secret === 'string' ? conversion.client_secret : null;
  const pem = typeof conversion.pem === 'string' ? conversion.pem : null;
  const webhookSecret =
    typeof conversion.webhook_secret === 'string' ? conversion.webhook_secret : null;

  await db('instance_settings')
    .where({ id: 1 })
    .update({
      github_app_id: conversion.id ?? null,
      github_app_slug: typeof conversion.slug === 'string' ? conversion.slug : null,
      github_app_client_id: typeof conversion.client_id === 'string' ? conversion.client_id : null,
      github_app_client_secret_encrypted: clientSecret ? encrypt(clientSecret) : null,
      github_app_private_key_encrypted: pem ? encrypt(pem) : null,
      github_app_webhook_secret_encrypted: webhookSecret ? encrypt(webhookSecret) : null,
      updated_at: new Date().toISOString(),
    });

  invalidateGithubAppCache();
}

export function defaultGithubManifestReturnPath(user) {
  if (!user?.onboarding_completed) return '/onboarding';
  return '/admin?tab=github';
}

export const MANIFEST_RETURN_COOKIE = 'github_manifest_return_to';
export const MANIFEST_RETURN_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
export const MANIFEST_STATE_COOKIE = 'github_manifest_state';
export const MANIFEST_STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const MANIFEST_STATE_QUERY = 'github_manifest_state';
