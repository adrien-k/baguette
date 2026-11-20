#!/usr/bin/env node
import knex from 'knex';
import { loadKnexConfig } from '../server/lib/load-knex-config.js';
import { seedE2eEnvironment } from '../server/lib/seed-e2e-environment.js';

const db = knex(await loadKnexConfig());
let failed = false;

try {
  await seedE2eEnvironment(db);
} catch (err) {
  console.error(`E2e seed failed: ${err instanceof Error ? err.message : err}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  failed = true;
} finally {
  await db.destroy();
}

if (failed) {
  process.exit(1);
}
