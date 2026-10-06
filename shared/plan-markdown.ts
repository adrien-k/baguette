/**
 * Extract plan markdown from a plan tool's input.
 *
 * Looks at the most common plan-text fields in order
 * (`plan`, `planContent`, `description`, `content`, `text`, `summary`) and falls
 * back to rendering an `allowedPrompts` array if the tool encodes its
 * prompt-permission policy instead of a plan body.
 *
 * Trivially provider-agnostic: the function has no SDK knowledge. Both Claude
 * and Cursor's plan tools pass their `input` (Claude) / `args` (Cursor)
 * straight through here.
 */
type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function planMarkdownFromToolInput(input: unknown): string {
  if (!isDict(input)) return '';
  for (const key of ['plan', 'planContent', 'description', 'content', 'text', 'summary']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (Array.isArray(input.allowedPrompts) && input.allowedPrompts.length > 0) {
    return `**Allowed actions:**\n\n${input.allowedPrompts
      .map((p: unknown) => `- ${isDict(p) ? String((p as Dict).prompt ?? '') : ''}`)
      .join('\n')}`;
  }
  return '';
}
