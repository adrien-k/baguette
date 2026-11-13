/**
 * Slack attachments: downloading them with the bot token (scope `files:read`) and describing them
 * to the agent. Text-like files (json, txt, csv, svg…) are shown inline; everything else is saved
 * to disk, outside any git worktree, for the agent's file tools (images, PDFs, archives…).
 */
import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from '../config.js';

export const SLACK_FILES_DIR = path.join(DATA_DIR, 'slack-files');

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_INLINE_BYTES_PER_FILE = 20 * 1024;
const MAX_INLINE_BYTES_TOTAL = 60 * 1024;
const MAX_FILES_DESCRIBED = 5;

const TEXT_MIMETYPES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/javascript',
  'application/sql',
  'application/x-sh',
  'image/svg+xml',
]);
const TEXT_EXTENSIONS = new Set(
  'txt md markdown json jsonl csv tsv svg xml html htm yaml yml toml ini conf env log diff patch sql sh css scss js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp php'.split(
    ' '
  )
);

export class SlackFileError extends Error {}

/** Where files for one Slack thread are saved. */
export const slackFilesDir = (slackAppId, channel, threadTs) =>
  path.join(SLACK_FILES_DIR, String(slackAppId), `${channel}-${threadTs}`);

/** Where files fetched by the SlackDownloadFile tool are saved for one session. */
export const slackSessionFilesDir = (sessionId) =>
  path.join(SLACK_FILES_DIR, `session-${sessionId}`);

/** Deletes downloaded-file directories; missing ones are fine. */
export async function removeSlackFileDirs(dirs) {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
}

export function isTextFile(file) {
  const mimetype = String(file.mimetype ?? '').toLowerCase();
  if (mimetype.startsWith('text/') || TEXT_MIMETYPES.has(mimetype)) return true;
  const extension = (file.filetype || path.extname(file.name ?? '').slice(1)).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

/** A file name safe to use on disk. */
export function safeFileName(name) {
  const base = path.basename(String(name ?? '')).replace(/[^\w.\- ]+/g, '_');
  return base.replace(/^\.+/, '').slice(0, 100) || 'file';
}

function formatSize(bytes) {
  if (bytes == null) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

/** The response body, aborting once it passes the size cap instead of buffering all of it. */
async function readCapped(res) {
  if (!res.body?.getReader) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      throw new SlackFileError(`the file is too large (${formatSize(buffer.length)})`);
    }
    return buffer;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel().catch(() => {});
      throw new SlackFileError(`the file is too large (over ${formatSize(MAX_DOWNLOAD_BYTES)})`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads `file` (a normalized Slack file) into `dir`.
 * @returns {Promise<{ path: string, size: number, text: string | null }>} `text` is set for text files.
 */
export async function downloadSlackFile(token, file, dir, { fetchFn = fetch } = {}) {
  if (!file.url) {
    throw new SlackFileError(
      'the file is not available (deleted, or hidden by a Slack plan limit)'
    );
  }
  if (file.size != null && file.size > MAX_DOWNLOAD_BYTES) {
    throw new SlackFileError(`the file is too large (${formatSize(file.size)})`);
  }
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  try {
    return await fetchAndSave(token, file, dir, fetchFn, signal);
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new SlackFileError('the download timed out');
    throw err;
  }
}

async function fetchAndSave(token, file, dir, fetchFn, signal) {
  const res = await fetchFn(file.url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!res.ok) throw new SlackFileError(`Slack answered HTTP ${res.status}`);

  const looksLikeLoginPage =
    String(res.headers.get('content-type') ?? '').includes('text/html') &&
    !/html/i.test(`${file.mimetype} ${file.filetype}`);
  if (looksLikeLoginPage) {
    throw new SlackFileError(
      'Slack returned a sign-in page instead of the file — the bot needs the files:read scope (add it and reinstall the app)'
    );
  }
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_DOWNLOAD_BYTES) {
    await res.body?.cancel?.().catch(() => {});
    throw new SlackFileError(`the file is too large (${formatSize(declared)})`);
  }
  const buffer = await readCapped(res);

  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${file.id ?? Date.now()}-${safeFileName(file.name)}`);
  await fs.writeFile(target, buffer);
  return {
    path: target,
    size: buffer.length,
    text: isTextFile(file) ? buffer.toString('utf8') : null,
  };
}

/** A code fence longer than any backtick run inside `text`, so the content cannot break out. */
function fenceFor(text) {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/** The "Attached files" block of the agent's Slack context ('' when there are none). */
export async function attachmentsContext(token, files, dir, deps) {
  if (!files?.length) return '';
  const shown = files.slice(0, MAX_FILES_DESCRIBED);
  const lines = [];
  let inlineBudget = MAX_INLINE_BYTES_TOTAL;

  for (const file of shown) {
    const label = `${file.name} (${file.mimetype ?? file.filetype ?? 'file'}, ${formatSize(file.size)})`;
    try {
      const saved = await downloadSlackFile(token, file, dir, deps);
      if (saved.text == null) {
        lines.push(`- ${label} → ${saved.path} (open it with your file or image tools)`);
        continue;
      }
      const allowed = Math.min(MAX_INLINE_BYTES_PER_FILE, inlineBudget);
      if (allowed <= 0) {
        lines.push(`- ${label} → ${saved.path} (not shown inline; read it with your file tools)`);
        continue;
      }
      const content = Buffer.from(saved.text).subarray(0, allowed).toString('utf8');
      inlineBudget -= Buffer.byteLength(content);
      const cut = Buffer.byteLength(saved.text) > Buffer.byteLength(content);
      const fence = fenceFor(content);
      lines.push(
        `- ${label} → ${saved.path}${cut ? ` (first ${formatSize(Buffer.byteLength(content))} shown)` : ''}\n` +
          `${fence}\n${content}\n${fence}`
      );
    } catch (err) {
      lines.push(`- ${label}: could not be downloaded — ${err.message}`);
    }
  }
  const more = files.length - shown.length;
  if (more > 0) lines.push(`- …and ${more} more file${more === 1 ? '' : 's'} (SlackDownloadFile)`);
  return `\n\nAttached files (downloaded for you):\n${lines.join('\n')}`;
}
