import { BadRequest } from 'feathers/errors';

/**
 * Apply ordered search/replace patches to stored plan markdown.
 * @param {string} markdown
 * @param {{ old_string: string; new_string?: string }[]} patches
 */
export function applySessionPlanPatches(markdown, patches) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new BadRequest('patches is required');
  }

  let text = markdown ?? '';

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const old_string = patch?.old_string != null ? String(patch.old_string) : '';
    const new_string = patch?.new_string != null ? String(patch.new_string) : '';

    if (!old_string) {
      throw new BadRequest(`patches[${i}].old_string is required`);
    }

    const idx = text.indexOf(old_string);
    if (idx === -1) {
      throw new BadRequest(`patches[${i}]: old_string not found in plan`);
    }

    text = text.slice(0, idx) + new_string + text.slice(idx + old_string.length);
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new BadRequest('plan markdown cannot be empty after patches');
  }

  return trimmed;
}
