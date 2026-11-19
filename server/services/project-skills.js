import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import logger from '../logger.js';
import { resolveDataDirRelativePath } from '../config.js';
import { BAGUETTE_DIR } from './baguette-config.js';

export const PROJECT_SKILLS_SUBDIR = path.join(BAGUETTE_DIR, 'skills');

const LABEL_MAX = 120;
const DESCRIPTION_MAX = 2000;
const CONTENT_MAX = 200_000;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

function requireText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

function parseSkillMarkdown(raw) {
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

  const label = requireText(meta.label, 'label', LABEL_MAX);
  if (/[\r\n]/.test(label)) throw new Error('label must be a single line');
  const description = requireText(meta.description, 'description', DESCRIPTION_MAX);
  const content = requireText(body, 'content', CONTENT_MAX);

  return { label, description, content };
}

/**
 * Markdown skills from `.baguette/skills/*.md` (YAML frontmatter: label, description; body = content).
 * @param {string|null|undefined} sessionPath
 * @returns {Promise<Array<{ label: string, description: string, content: string, source: 'project', rel_path: string }>>}
 */
export async function loadProjectSkills(sessionPath) {
  const absoluteSessionPath = resolveDataDirRelativePath(sessionPath);
  if (!absoluteSessionPath) return [];

  const skillsDir = path.join(absoluteSessionPath, PROJECT_SKILLS_SUBDIR);
  let names;
  try {
    names = await fs.promises.readdir(skillsDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    logger.error(err, 'Failed to read %s', PROJECT_SKILLS_SUBDIR);
    return [];
  }

  const mdFiles = names.filter((name) => name.endsWith('.md')).sort();
  const byLabel = new Map();

  for (const fileName of mdFiles) {
    const relPath = path.join(PROJECT_SKILLS_SUBDIR, fileName);
    const filePath = path.join(skillsDir, fileName);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed = parseSkillMarkdown(raw);
      if (byLabel.has(parsed.label)) {
        logger.warn(
          'Skipping duplicate project skill label %s in %s (already from %s)',
          parsed.label,
          relPath,
          byLabel.get(parsed.label).rel_path
        );
        continue;
      }
      byLabel.set(parsed.label, {
        ...parsed,
        source: 'project',
        rel_path: relPath,
      });
    } catch (err) {
      logger.warn('Skipping invalid project skill %s: %s', relPath, err.message);
    }
  }

  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}
