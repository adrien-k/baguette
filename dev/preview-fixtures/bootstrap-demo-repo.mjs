/**
 * Materializes dev/preview-fixtures/demo-repo from demo-repo-template and creates
 * preview-single / preview-multi branches with distinct .baguette.yaml files.
 */
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'demo-repo-template');
const REPO_DIR = path.join(__dirname, 'demo-repo');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Baguette',
  GIT_AUTHOR_EMAIL: 'baguette@localhost',
  GIT_COMMITTER_NAME: 'Baguette',
  GIT_COMMITTER_EMAIL: 'baguette@localhost',
};

const SINGLE_YAML = `config:
  session:
    tasks:
      web:
        run: node scripts/http-server.mjs WEB_PORT web
        ports: [WEB_PORT]
  webserver:
    task: web
    expose: WEB_PORT
    description: Single demo HTTP service for local Baguette preview development
`;

const MULTI_YAML = `config:
  session:
    tasks:
      frontend:
        run: node scripts/http-server.mjs FRONTEND_PORT frontend
        ports: [FRONTEND_PORT]
      api:
        run: node scripts/http-server.mjs API_PORT api
        ports: [API_PORT]
  services:
    frontend:
      task: frontend
      expose: FRONTEND_PORT
      description: Demo frontend (echo HTTP server)
    api:
      task: api
      expose: API_PORT
      description: Demo API (echo HTTP server)
`;

async function copyTemplate() {
  await fs.rm(REPO_DIR, { recursive: true, force: true });
  await fs.cp(TEMPLATE_DIR, REPO_DIR, { recursive: true });
}

async function git(args, opts = {}) {
  await execFileAsync('git', args, {
    cwd: REPO_DIR,
    env: GIT_ENV,
    ...opts,
  });
}

export async function bootstrapDemoRepo() {
  const headMarker = path.join(REPO_DIR, '.baguette-fixture-version');
  const version = '1';
  try {
    const existing = await fs.readFile(headMarker, 'utf8');
    if (existing.trim() === version) {
      return REPO_DIR;
    }
  } catch {
    /* rebuild */
  }

  await copyTemplate();
  await git(['init', '-b', 'main']);
  await git(['add', '-A']);
  await git(['commit', '-m', 'Initial fixture template']);

  await git(['checkout', '-B', 'preview-single']);
  await fs.writeFile(path.join(REPO_DIR, '.baguette.yaml'), SINGLE_YAML, 'utf8');
  await git(['add', '.baguette.yaml']);
  await git(['commit', '-m', 'Add single webserver preview config']);

  await git(['checkout', '-B', 'preview-multi']);
  await fs.writeFile(path.join(REPO_DIR, '.baguette.yaml'), MULTI_YAML, 'utf8');
  await git(['add', '.baguette.yaml']);
  await git(['commit', '-m', 'Add multi-service preview config']);

  await git(['checkout', 'main']);
  await fs.writeFile(headMarker, `${version}\n`, 'utf8');
  await git(['add', '.baguette-fixture-version']);
  await git(['commit', '-m', 'Mark fixture bootstrap version']);

  return REPO_DIR;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bootstrapDemoRepo()
    .then((dir) => {
      console.log(`Demo preview repo ready at ${dir}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
