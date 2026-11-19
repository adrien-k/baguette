import * as yaml from 'js-yaml';

export const SKILL_LABEL_MAX = 120;
export const SKILL_DESCRIPTION_MAX = 2000;
export const SKILL_CONTENT_MAX = 200_000;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

function requireText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

/**
 * Parse a skill markdown file (YAML frontmatter: label, description; body = content).
 * @param {string} raw
 * @returns {{ label: string, description: string, content: string }}
 */
export function parseSkillMarkdown(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new Error('file is empty');

  let meta = {};
  let body = trimmed;
  const match = FRONTMATTER_RE.exec(trimmed);
  if (match) {
    try {
      const loaded = yaml.load(match[1]);
      if (loaded != null && typeof loaded === 'object' && !Array.isArray(loaded)) {
        meta = loaded;
      } else {
        throw new Error('frontmatter must be a YAML mapping');
      }
    } catch (err) {
      throw new Error(`invalid frontmatter: ${err.message}`);
    }
    body = (match[2] ?? '').trim();
  }

  const label = requireText(meta.label, 'label', SKILL_LABEL_MAX);
  if (/[\r\n]/.test(label)) throw new Error('label must be a single line');
  const description = requireText(meta.description, 'description', SKILL_DESCRIPTION_MAX);
  const content = requireText(body, 'content', SKILL_CONTENT_MAX);

  return { label, description, content };
}
