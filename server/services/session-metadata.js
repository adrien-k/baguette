/**
 * Budget for one SDK `completeText` call. SDK services import this so every SDK uses
 * the same fail-fast deadline (provisioning must not wait on stuck subprocesses).
 */
export const METADATA_TIMEOUT_MS = 30_000;

/** Longest session label kept from a completion (matches the old JSON flow). */
const LABEL_MAX_LENGTH = 80;
/** Longest generated branch name, including the short-id suffix. */
const BRANCH_MAX_LENGTH = 60;

/**
 * Shared one-shot metadata generation.
 *
 * Each agent SDK exposes a primitive `completeText(prompt, opts)` that sends a prompt
 * string and returns the raw response text (see the SDK services). The session label,
 * branch name, and agent names are all derived here from that single completion, so
 * every SDK produces consistent metadata without duplicating prompt/parsing logic.
 */

/** Generic prompt: ask for a short title only; the branch slug is derived programmatically. */
export function buildMetadataPrompt(taskPrompt) {
  return `Generate a short title for the coding task below. Output ONLY the title text, nothing else:
- very short (max 50 characters)
- no quotes, no markdown, no explanation

Task: ${taskPrompt}`;
}

/** Clean a completion into a usable label: '' when nothing usable came back. */
export function labelFromCompletionText(text) {
  let raw = String(text ?? '').trim();
  if (!raw) return '';
  // Strip a fenced code block if the model added one despite the instruction.
  raw = raw
    .replace(/^```[a-z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  // Only the first non-empty line survives.
  raw = raw.split('\n').find((line) => line.trim()) ?? '';
  raw = raw.trim();
  // Strip leading bullets/markup and surrounding quotes.
  raw = raw
    .replace(/^[-*>#\s]+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  return raw.replace(/\.+$/, '').slice(0, LABEL_MAX_LENGTH);
}

/** Derive a kebab-case branch name from the label, suffixed with the short id. */
export function branchNameFromLabel(label, shortId) {
  const suffix = shortId ? `-${shortId}` : '';
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.slice(0, Math.max(1, BRANCH_MAX_LENGTH - suffix.length)).replace(/-+$/g, '');
  if (!base) return `task-${shortId}`;
  return `${base}${suffix}`;
}

/**
 * Run the shared title prompt through an SDK service and derive the session label and
 * branch name. SDK `completeText` must resolve within METADATA_TIMEOUT_MS, clean up its
 * own subprocess on timeout, and return '' when it cannot complete (missing credentials).
 *
 * @param {{ completeText: (prompt: string, opts: object) => Promise<string> }} service SDK agent service
 * @param {{ taskPrompt: string, userId?: number | null, agentConfigId?: number | null, model?: string | null, modelParams?: unknown, shortId?: string | null }} opts
 *   `shortId` is used only for the branch suffix — it is not forwarded to the SDK.
 * @returns {Promise<{ label: string, branchName: string }>}
 */
export async function completeSessionMetadata(service, opts) {
  const text = await service.completeText(buildMetadataPrompt(opts.taskPrompt), {
    userId: opts.userId ?? null,
    agentConfigId: opts.agentConfigId ?? null,
    model: opts.model ?? null,
    modelParams: opts.modelParams ?? null,
  });
  const label = labelFromCompletionText(text);
  return { label, branchName: branchNameFromLabel(label, opts.shortId ?? '') };
}
