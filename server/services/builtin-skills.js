import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { parseSkillMarkdown } from './skill-markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILLS_DIR = path.join(__dirname, '..', 'skills');

/**
 * @returns {Promise<Array<{ label: string, description: string, content: string, source: 'builtin', builtin_id: string }>>}
 */
export async function loadBuiltinSkills() {
  let names;
  try {
    names = await fs.promises.readdir(BUILTIN_SKILLS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    logger.error(err, 'Failed to read built-in skills directory');
    return [];
  }

  const mdFiles = names.filter((name) => name.endsWith('.md')).sort();
  const byLabel = new Map();

  for (const fileName of mdFiles) {
    const builtinId = fileName.replace(/\.md$/i, '');
    const filePath = path.join(BUILTIN_SKILLS_DIR, fileName);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed = parseSkillMarkdown(raw);
      if (byLabel.has(parsed.label)) {
        logger.warn(
          'Skipping duplicate built-in skill label %s in %s (already from %s)',
          parsed.label,
          fileName,
          byLabel.get(parsed.label).builtin_id
        );
        continue;
      }
      byLabel.set(parsed.label, {
        ...parsed,
        source: 'builtin',
        builtin_id: builtinId,
      });
    } catch (err) {
      logger.warn('Skipping invalid built-in skill %s: %s', fileName, err.message);
    }
  }

  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}
