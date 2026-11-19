#!/usr/bin/env node
/**
 * Compile server/ + shared/ to dist/ (TypeScript → JavaScript, .ts imports → .js).
 * Static assets (migrations, prompts, views) are copied alongside.
 */
import fs, { glob as fsGlob } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');

const IGNORE = ['**/__tests__/**', '**/*.test.js', '**/*.test.ts', '**/*.live.test.js'];

const ASSET_DIRS = [
  { from: 'server/migrations', to: 'server/migrations' },
  { from: 'server/prompts', to: 'server/prompts' },
  { from: 'server/views', to: 'server/views' },
  { from: 'server/data', to: 'server/data' },
];

async function rmDist() {
  await fs.rm(distRoot, { recursive: true, force: true });
}

async function globAbsolute(pattern, cwd, exclude = []) {
  const matches = [];
  for await (const entry of fsGlob(pattern, { cwd, exclude })) {
    matches.push(path.resolve(cwd, entry));
  }
  return matches;
}

async function copyAssetTree(relPath) {
  const src = path.join(root, relPath.from);
  const dest = path.join(distRoot, relPath.to);
  try {
    await fs.access(src);
  } catch {
    return;
  }
  await fs.cp(src, dest, { recursive: true });
}

async function main() {
  await rmDist();

  const patterns = ['server/**/*.{js,ts}', 'shared/**/*.{js,ts}'];
  const entryPoints = [];
  for (const pattern of patterns) {
    const matches = await globAbsolute(pattern, root, IGNORE);
    entryPoints.push(...matches);
  }

  if (entryPoints.length === 0) {
    console.error('build-server: no entry points found');
    process.exit(1);
  }

  await esbuild.build({
    entryPoints,
    outdir: distRoot,
    outbase: root,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    logLevel: 'info',
  });

  for (const asset of ASSET_DIRS) {
    await copyAssetTree(asset);
  }

  await fixTypeScriptImportSpecifiers(distRoot);

  console.log(`build-server: wrote ${entryPoints.length} modules under dist/`);
}

/** esbuild leaves `.ts` extensions on external self-imports; Node needs `.js`. */
async function fixTypeScriptImportSpecifiers(dir) {
  const files = await globAbsolute('**/*.js', dir);
  for (const file of files) {
    const code = await fs.readFile(file, 'utf8');
    const fixed = code
      .replace(/(?<=from ['"][^'"]+)\.ts(?=['"])/g, '.js')
      .replace(/(?<=import\(['"][^'"]+)\.ts(?=['"]\))/g, '.js');
    if (fixed !== code) await fs.writeFile(file, fixed);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
