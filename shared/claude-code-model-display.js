/**
 * Human-readable labels for Claude Code SDK model rows (supportedModels()).
 * The SDK's displayName is often the family only ("Sonnet"); the description
 * headline carries the version ("Sonnet 5 · …").
 */

function firstDescriptionHeadline(description) {
  if (!description || typeof description !== 'string') return '';
  const headline = description.split(' · ')[0]?.trim() ?? '';
  return headline;
}

function familyWord(displayName) {
  const trimmed = (displayName || '').trim();
  if (!trimmed) return '';
  return trimmed.split(/[\s(]/)[0] ?? '';
}

/**
 * @param {{ displayName?: string, description?: string | null }} model
 * @returns {string}
 */
export function claudeCodeModelDisplayName({ displayName, description }) {
  const name = (displayName || '').trim();
  if (!name) return '';

  const headline = firstDescriptionHeadline(description);
  if (!headline || !/\d/.test(headline)) return name;

  const family = familyWord(name);
  if (!family) return name;

  if (!headline.toLowerCase().startsWith(family.toLowerCase())) return name;

  return headline;
}
