/**
 * Idempotently seeds local dev data: preview fixture git repo, dev user, and two preview sessions.
 * Run after migrate: `pnpm run seed:dev-db`
 */
import path from 'path';
import { fileURLToPath } from 'url';

import '../server/config.js';
import logger from '../server/logger.js';
import db from '../server/db.js';
import { createFeathersApp } from '../server/feathers.js';
import { registerFeathersServices } from '../server/services/feathers/index.js';
import { SseManager } from '../server/lib/sse-manager.js';
import { bootstrapDemoRepo } from './preview-fixtures/bootstrap-demo-repo.mjs';

const thisFile = fileURLToPath(import.meta.url);

export const DEV_PREVIEW_SEED_SHORT_IDS = {
  single: 'de000001',
  multi: 'de000002',
};

const SESSION_SPECS = [
  {
    short_id: DEV_PREVIEW_SEED_SHORT_IDS.single,
    label: 'Dev preview: single webserver',
    branch: 'preview-single',
  },
  {
    short_id: DEV_PREVIEW_SEED_SHORT_IDS.multi,
    label: 'Dev preview: multi-service',
    branch: 'preview-multi',
  },
];

async function createSeedApp() {
  const app = createFeathersApp();
  app.set('db', db);
  registerFeathersServices(app, new SseManager());
  await app.setup();
  return app;
}

async function ensureDevUser(app) {
  const existing = await db('users').where({ email: 'dev@baguette.local' }).first();
  if (existing) return existing;

  const devGhKey = process.env.DEV_USER_GH_KEY || '';
  return app.service('users').create(
    {
      github_id: 0,
      username: 'dev',
      email: 'dev@baguette.local',
      access_token: devGhKey,
      approved: true,
      onboarding_completed: true,
    },
    {}
  );
}

export async function seedDevDb(app) {
  const existing = await db('sessions')
    .whereIn(
      'short_id',
      SESSION_SPECS.map((s) => s.short_id)
    )
    .select('short_id');
  if (existing.length === SESSION_SPECS.length) {
    logger.info('Dev DB seed already applied (preview sessions exist); skipping');
    return { skipped: true };
  }

  const user = await ensureDevUser(app);
  const repoDir = await bootstrapDemoRepo();
  const localPath = path.resolve(repoDir);

  const { repo } = await app.service('repos').createLocal({ localPath }, { user });

  for (const spec of SESSION_SPECS) {
    const already = await db('sessions').where({ short_id: spec.short_id }).first();
    if (already) continue;

    await app.service('sessions').create(
      {
        short_id: spec.short_id,
        repo_full_name: repo.full_name,
        base_branch: spec.branch,
        create_new_branch: false,
        initial_prompt: 'Local preview fixture — use the Preview tab to start services.',
        label: spec.label,
        agent_sdk: 'claude',
        auto_push: false,
      },
      { user, provider: undefined }
    );
    const created = await db('sessions').where({ short_id: spec.short_id }).first();
    if (created) {
      await app
        .service('sessions')
        .patch(created.id, { status: 'stopped' }, { user, provider: undefined });
      await app
        .service('claude-agent')
        .stopSession(created.id)
        .catch(() => {});
    }
    logger.info({ shortId: spec.short_id, branch: spec.branch }, 'Seeded dev preview session');
  }

  const signIn = `${process.env.PUBLIC_HOST || 'http://localhost:5173'}/auth/dev`;
  logger.info(
    { repo: repo.full_name, signIn },
    'Dev preview fixture ready (two sessions). Sign in as dev if needed.'
  );
  return { skipped: false, repo: repo.full_name, signIn };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    logger.error('Refusing to run seed:dev-db in production');
    process.exitCode = 1;
    return;
  }

  const app = await createSeedApp();
  try {
    await seedDevDb(app);
  } finally {
    await db.destroy();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile);
if (isMain) {
  main().catch((err) => {
    logger.error({ err }, 'Dev DB seed failed');
    process.exitCode = 1;
  });
}
