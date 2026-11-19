import fs from 'fs';
import path from 'path';
import logger from '../logger.js';
import { resolveDataDirRelativePath } from '../config.js';
import { BAGUETTE_DIR } from './baguette-config.js';
import { parseSkillMarkdown } from './skill-markdown.js';

const PROJECT_SKILLS_SUBDIR = path.join(BAGUETTE_DIR, 'skills');

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
