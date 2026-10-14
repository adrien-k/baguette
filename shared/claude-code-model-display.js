/**
 * Human-readable labels for Claude Code SDK model rows (supportedModels()).
 * The SDK's displayName is often the family only ("Sonnet"); the description
 * headline carries the version ("Sonnet 5 · …"). `resolvedModel` is the source
 * of truth for patch releases (e.g. claude-sonnet-5-5 → Sonnet 5.5).
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

function capitalizeFamily(family) {
  if (!family) return '';
  return family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
}

/**
 * @param {string | null | undefined} wireId — e.g. claude-sonnet-5-5, claude-opus-5[1m]
 * @returns {string}
 */
export function displayNameFromClaudeWireModelId(wireId) {
  const raw = String(wireId ?? '').trim();
  if (!raw) return '';

  const has1m = /\[1m\]$/i.test(raw);
  const id = raw.replace(/\[1m\]$/i, '');
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d+)?$/i.exec(id);
  if (!match) return '';

  const family = capitalizeFamily(match[1]);
  const major = match[2];
  const minor = match[3];
  const version = minor ? `${major}.${minor}` : major;
  let label = `${family} ${version}`;
  if (has1m) label += ' with 1M context';
  return label;
}

/** @param {string} label */
function versionSegmentCount(label) {
  const m = /\s(\d+(?:\.\d+)*)\b/.exec(label);
  if (!m) return 0;
  return m[1].split('.').length;
}

/**
 * Prefer the label with a more specific version (Sonnet 5.5 over Sonnet 5).
 * @param {string} a
 * @param {string} b
 */
function preferMorePreciseVersionLabel(a, b) {
  if (!a) return b;
  if (!b) return a;
  const familyA = familyWord(a);
  const familyB = familyWord(b);
  if (familyA && familyB && familyA.toLowerCase() !== familyB.toLowerCase()) {
    return b;
  }
  const segmentsA = versionSegmentCount(a);
  const segmentsB = versionSegmentCount(b);
  if (segmentsB > segmentsA) return b;
  if (segmentsA > segmentsB) return a;
  if (b.length > a.length) return b;
  return a;
}

function isDefaultPickerLabel(displayName) {
  const name = (displayName || '').trim();
  if (!name) return false;
  return /^default\b/i.test(name);
}

/**
 * @param {{ displayName?: string, description?: string | null, resolvedModel?: string | null, value?: string | null }} model
 * @returns {string}
 */
export function claudeCodeModelDisplayName({ displayName, description, resolvedModel, value }) {
  const name = (displayName || '').trim();
  if (!name) return '';

  if (isDefaultPickerLabel(name)) return name;

  const fromWire =
    displayNameFromClaudeWireModelId(resolvedModel) || displayNameFromClaudeWireModelId(value);

  const headline = firstDescriptionHeadline(description);
  let fromDescription = '';
  if (headline && /\d/.test(headline)) {
    const family = familyWord(name);
    if (family && headline.toLowerCase().startsWith(family.toLowerCase())) {
      fromDescription = headline;
    }
  }

  if (fromWire) {
    if (fromDescription && /1m context/i.test(fromDescription) && !/1m context/i.test(fromWire)) {
      return fromDescription;
    }
    return preferMorePreciseVersionLabel(fromDescription, fromWire);
  }

  if (fromDescription) return fromDescription;
  return name;
}
