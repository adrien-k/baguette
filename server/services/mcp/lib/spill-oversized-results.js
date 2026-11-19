import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Oversized tool results are never returned inline to the model. Instead the
 * full text is spilled to a per-session file under `<session>/.data/tool-results/`
 * and the tool result is replaced with a short notice telling the agent where
 * the full output lives and how to read it in chunks. This prevents unbounded
 * tool output (e.g. a full CI log) from blowing the model's context window —
 * see the 864k-token PrWorkflowLogs incident.
 */

/** Maximum bytes for a tool result content text before it is spilled to disk. */
export const MAX_TOOL_RESULT_BYTES = 131072;

export const TOOL_RESULTS_DIR = '.data/tool-results';

function toolNameSlug(toolName) {
  return (
    String(toolName || 'tool')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 48) || 'tool'
  );
}

/**
 * Spill `text` to a file under `baseDir` and return path info.
 * The filename is derived from the content hash so repeated spills of the
 * same payload (e.g. a poisoned history entry seen on every LLM call) reuse
 * the same file.
 *
 * @param {string} baseDir absolute directory to write into
 * @param {string} toolName tool name for a readable filename
 * @param {string} text full result text
 * @returns {Promise<{ absolutePath: string, relativePath: string, totalBytes: number }>}
 */
export async function spillTextToFile(baseDir, toolName, text) {
  const buf = Buffer.from(text, 'utf8');
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const filename = `${toolNameSlug(toolName)}-${hash}.txt`;
  await mkdir(baseDir, { recursive: true });
  const absolutePath = path.join(baseDir, filename);
  await writeFile(absolutePath, buf);
  return { absolutePath, totalBytes: buf.length };
}

/**
 * Build the model-facing notice replacing an oversized tool result.
 *
 * @param {string} relativePath path of the spilled file, relative to the session cwd
 * @param {number} totalBytes size of the spilled text in bytes
 * @param {boolean} isError whether the original result reported an error
 * @returns {string}
 */
export function isSpilledResultNotice(text) {
  return (
    typeof text === 'string' &&
    text.startsWith('Tool result too large to include inline (') &&
    text.includes('Full output saved to ')
  );
}

/**
 * @param {string} sessionPath absolute session worktree root
 * @returns {{ baseDir: string, cwd: string }}
 */
export function toolResultSpillDirs(sessionPath) {
  const baseDir = path.join(sessionPath, TOOL_RESULTS_DIR);
  return { baseDir, cwd: sessionPath };
}

/**
 * Spill a raw UTF-8 string to the session spill dir and return the model notice.
 *
 * @param {string} text
 * @param {{ sessionPath: string, toolName: string, isError?: boolean }} opts
 * @returns {Promise<string>}
 */
export async function spillToolTextToSessionNotice(
  text,
  { sessionPath, toolName, isError = false }
) {
  const { baseDir, cwd } = toolResultSpillDirs(sessionPath);
  const { absolutePath, totalBytes } = await spillTextToFile(baseDir, toolName, text);
  const relativePath = path.relative(cwd, absolutePath).split(path.sep).join('/');
  return spilledResultNotice(relativePath, totalBytes, isError);
}

/**
 * Guard a raw tool result before persistence: spill oversized string bodies.
 *
 * @param {unknown} rawResult
 * @param {{ sessionPath: string, toolName: string }} opts
 * @returns {Promise<unknown>}
 */
export async function spillOversizedRawToolResult(rawResult, { sessionPath, toolName }) {
  if (rawResult == null || isSpilledResultNotice(rawResult)) return rawResult;
  if (typeof rawResult === 'string') {
    if (Buffer.byteLength(rawResult, 'utf8') <= MAX_TOOL_RESULT_BYTES) return rawResult;
    const isError = parseOkFlag(rawResult);
    return spillToolTextToSessionNotice(rawResult, { sessionPath, toolName, isError });
  }
  if (typeof rawResult === 'object') {
    try {
      const text = JSON.stringify(rawResult);
      if (Buffer.byteLength(text, 'utf8') <= MAX_TOOL_RESULT_BYTES) return rawResult;
      const isError = parseOkFlag(text);
      return spillToolTextToSessionNotice(text, { sessionPath, toolName, isError });
    } catch {
      return rawResult;
    }
  }
  return rawResult;
}

export function spilledResultNotice(relativePath, totalBytes, isError = false) {
  const lines = [
    `Tool result too large to include inline (${totalBytes} bytes). Full output saved to ${relativePath}.`,
    'Read that file in chunks (read tool with offset/limit) or grep it for the relevant part instead of re-fetching the whole result.',
  ];
  if (isError) {
    lines.push('The original tool call reported an error.');
  }
  return lines.join('\n');
}

function firstText(result) {
  const block = result?.content?.[0];
  if (block?.type === 'text' && typeof block.text === 'string') {
    return block;
  }
  return null;
}

function parseOkFlag(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.ok === false) return true;
  } catch {
    // Non-JSON text.
  }
  return false;
}

/**
 * Guard an MCP tool result (`{ content: [{ type: 'text', text }] }`): when its
 * text exceeds MAX_TOOL_RESULT_BYTES, spill the full text to `baseDir` and
 * replace the content with a pointer notice. Small results are returned
 * unchanged.
 *
 * @param {object|undefined} result
 * @param {{ baseDir: string, cwd?: string, toolName: string }} opts
 * @returns {Promise<object|undefined>}
 */
export async function spillOversizedToolResult(result, { baseDir, cwd, toolName }) {
  const textBlock = firstText(result);
  if (!textBlock) return result;
  const text = textBlock.text;
  if (Buffer.byteLength(text, 'utf8') <= MAX_TOOL_RESULT_BYTES) {
    return result;
  }
  const isError = parseOkFlag(text);
  const { absolutePath, totalBytes } = await spillTextToFile(baseDir, toolName, text);
  const relativePath = path
    .relative(cwd || path.dirname(path.dirname(baseDir)), absolutePath)
    .split(path.sep)
    .join('/');
  return {
    ...result,
    content: [
      {
        ...textBlock,
        text: spilledResultNotice(relativePath, totalBytes, isError),
      },
    ],
  };
}
