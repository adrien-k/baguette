#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.chdir(root);

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'migrate') {
  runNode('scripts/migrate-latest.js', args);
  process.exit(0);
}

if (cmd && cmd !== 'start') {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: baguette [start] | baguette migrate');
  process.exit(1);
}

runNode('scripts/migrate-latest.js');

const distEntry = path.join(root, 'dist', 'server', 'index.js');
const entry = fs.existsSync(distEntry) ? distEntry : path.join(root, 'server', 'index.js');
await import(pathToFileURL(entry).href);
