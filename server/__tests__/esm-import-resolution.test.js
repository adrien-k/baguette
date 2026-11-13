import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');

// Loaded via jiti at runtime, which resolves `.js` specifiers against `.ts`
// files — the exactness guarantee below does not apply to them.
const JITI_DIRS = new Set([path.join(repoRoot, 'server/agent-sdks/pi/extensions')]);
const SKIP_DIRS = new Set(['node_modules', '.data', 'dist']);

/** Static type-import paths (`@param {import('…')}`) live in comments — not runtime modules. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function walk(dir) {
  if (JITI_DIRS.has(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(p));
    } else if (/\.(js|ts|mjs|cjs)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('server and shared ESM import specifiers', () => {
  it('resolve every relative specifier to an exact file (node does not map .js to .ts)', () => {
    // Node strips types natively without extension rewriting: a `.js`
    // specifier must be a real `.js` file and a `.ts` specifier a real `.ts`
    // file. Vitest and tsc both accept `.js` pointing at a `.ts` module, so
    // this only fails at production boot — pin the graph statically instead.
    const problems = [];
    for (const file of [
      ...walk(path.join(repoRoot, 'server')),
      ...walk(path.join(repoRoot, 'shared')),
      ...walk(path.join(repoRoot, 'scripts')),
    ]) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/(?:from\s+|import\s+|import\(\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
        const resolved = path.resolve(path.dirname(file), m[1]);
        if (!fs.existsSync(resolved)) {
          problems.push(`${path.relative(repoRoot, file)} imports missing ${m[1]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
