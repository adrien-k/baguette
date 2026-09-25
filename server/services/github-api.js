import { GitHubBadCredentialsError } from '../errors/github-errors.js';

/**
 * Standard GitHub REST headers. Pass `token` when the caller has one.
 */
export function githubAuthHeaders(token, { accept, ...extra } = {}) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: accept ?? 'application/vnd.github.v3+json',
    'User-Agent': 'baguette-app',
    ...extra,
  };
}

export function isGitHubBadCredentialsBody(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  try {
    const body = JSON.parse(text);
    return body?.message === 'Bad credentials';
  } catch {
    return false;
  }
}

/**
 * GitHub API fetch: applies auth, Accept, and User-Agent; merges `init.headers` on top.
 * Throws {@link GitHubBadCredentialsError} on 401 with GitHub's "Bad credentials" body.
 *
 * @param {string} url
 * @param {RequestInit & { token?: string, accept?: string }} [init]
 */
export async function githubFetch(url, init = {}) {
  const { token, accept, headers: extraHeaders, ...fetchInit } = init;

  const plainHeaders =
    extraHeaders instanceof Headers
      ? Object.fromEntries(extraHeaders.entries())
      : { ...(extraHeaders || {}) };

  const headers = {
    ...githubAuthHeaders(token, { accept }),
    ...plainHeaders,
  };

  const res = await fetch(url, { ...fetchInit, headers });

  if (res.status !== 401) return res;

  try {
    const text = await res.clone().text();
    if (isGitHubBadCredentialsBody(text)) {
      throw new GitHubBadCredentialsError();
    }
  } catch (err) {
    if (err instanceof GitHubBadCredentialsError) throw err;
    // ignore clone/read failures — return the 401 response
  }
  return res;
}
