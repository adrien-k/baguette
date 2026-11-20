import fs from 'fs';
import path from 'path';
import { githubFetch } from '../services/github-api.js';

/**
 * Uploads a session image to GitHub and returns the asset URL to embed in the
 * PR body.
 *
 * GitHub hosts attachments for issues/PRs at `uploads.github.com/user-attachments`
 * (the same endpoint the website and the GitHub CLI use; undocumented but stable
 * across both). It is plain REST: resolve the repository's numeric id, then POST
 * the bytes — the response carries the hosted asset URL. Everything runs with
 * the user's GitHub token through `githubFetch`, like every other API call.
 *
 * Alt text is handled at body-swap time (`![alt](url)`); the upload only needs
 * the bytes.
 */

const GH_UPLOAD_ENDPOINT = 'https://uploads.github.com/user-attachments/assets';

/**
 * The endpoint answers 404 when the token cannot write (instead of 403),
 * so name the real failure.
 */
export function uploadImageErrorDetail(status, message) {
  if (status === 404) {
    return `${status} ${message} — attaching files requires write access to the repository`;
  }
  return `${status} ${message}`;
}

/** Resolves the repository's numeric id (`repository_id` in the upload query). */
export async function fetchRepositoryId({ repoFullName, token }) {
  const res = await githubFetch(`https://api.github.com/repos/${repoFullName}`, { token });
  if (!res.ok) {
    throw new Error(
      `Could not look up repository ${repoFullName}: ${res.status} ${res.statusText}`
    );
  }
  const data = await res.json();
  const id = data?.id;
  if (!Number.isInteger(id)) {
    throw new Error(`Could not resolve the repository id for ${repoFullName}`);
  }
  return id;
}

/** Uploads one image and resolves its GitHub asset URL. */
export async function uploadImageAsset({ repoFullName, token, imageFilePath, mediaType }) {
  const repositoryId = await fetchRepositoryId({ repoFullName, token });
  const name = path.basename(imageFilePath);
  const bytes = await fs.promises.readFile(imageFilePath);

  const uploadUrl =
    `${GH_UPLOAD_ENDPOINT}?name=${encodeURIComponent(name)}` +
    `&content_type=${encodeURIComponent(mediaType || 'application/octet-stream')}` +
    `&repository_id=${encodeURIComponent(repositoryId)}`;

  const res = await githubFetch(uploadUrl, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json())?.message || message;
    } catch {
      // keep statusText
    }
    throw new Error(`Could not upload ${name}: ${uploadImageErrorDetail(res.status, message)}`);
  }

  const data = await res.json().catch(() => null);
  const url = data?.url;
  if (!url) {
    throw new Error(`GitHub did not return an asset URL for ${name}`);
  }
  return { url };
}
