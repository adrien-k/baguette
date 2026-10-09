/** Unified diff larger than this is returned one file at a time (`file_by_file`). */
export const MAX_INLINE_DIFF_BYTES = 512 * 1024;

export function isMaxBufferExceeded(err) {
  return err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

export function isDiffWithinInlineLimit(diff) {
  if (!diff) return true;
  return Buffer.byteLength(diff, 'utf8') <= MAX_INLINE_DIFF_BYTES;
}

function diffFilePaths(files) {
  return (files ?? [])
    .map((f) => f.new_path || f.old_path)
    .filter((p) => typeof p === 'string' && p.length > 0);
}

/** Returns `requestedFile` only when it is in the changed-file list (no fallback). */
export function resolveRequestedDiffFile(files, requestedFile) {
  const path = requestedFile && typeof requestedFile === 'string' ? requestedFile.trim() : '';
  if (!path) return null;
  return diffFilePaths(files).includes(path) ? path : null;
}

export function pickDiffFilePath(files, requestedFile) {
  const paths = diffFilePaths(files);
  if (requestedFile && paths.includes(requestedFile)) return requestedFile;
  return paths[0] ?? null;
}

/**
 * @param {object} opts
 * @param {() => Promise<string>} opts.getFullDiff
 * @param {() => Promise<Array<{ old_path: string, new_path: string }>>} opts.getFileList
 * @param {(filePath: string) => Promise<string>} opts.getFileDiff
 * @param {string | null | undefined} opts.requestedFile
 * @param {boolean} [opts.knownFileByFile]
 * @returns {Promise<{ diff: string, file_by_file: boolean, file_path: string | null }>}
 */
export async function resolveSessionDiffResponse({
  getFullDiff,
  getFileList,
  getFileDiff,
  requestedFile,
  knownFileByFile = false,
}) {
  const fileParam =
    requestedFile && typeof requestedFile === 'string' ? requestedFile.trim() : null;

  if (knownFileByFile && fileParam) {
    const files = await getFileList();
    const file = resolveRequestedDiffFile(files, fileParam);
    if (!file) return { diff: '', file_by_file: true, file_path: null };
    const diff = await getFileDiff(file);
    return { diff, file_by_file: true, file_path: file };
  }

  let inlineDiff = null;
  try {
    inlineDiff = await getFullDiff({ maxBuffer: MAX_INLINE_DIFF_BYTES });
  } catch (err) {
    if (!isMaxBufferExceeded(err)) throw err;
  }
  if (inlineDiff !== null && isDiffWithinInlineLimit(inlineDiff)) {
    return { diff: inlineDiff, file_by_file: false, file_path: null };
  }

  const files = await getFileList();
  const file = pickDiffFilePath(files, fileParam);
  if (!file) return { diff: '', file_by_file: true, file_path: null };
  const diff = await getFileDiff(file);
  return { diff, file_by_file: true, file_path: file };
}
