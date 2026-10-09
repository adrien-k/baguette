#!/usr/bin/env node
import knex from 'knex';
import knexfile from '../knexfile.js';

const db = knex(knexfile);
let failed = false;

try {
  const [batchNo, log] = await db.migrate.latest();
  if (!log.length) {
    console.log('No pending migrations.');
  } else {
    console.log(
      `Applied batch ${batchNo} (${log.length} migration${log.length === 1 ? '' : 's'}):`
    );
    for (const name of log) {
      console.log(`  ${name}`);
    }
  }
} catch (err) {
  // Keep the concise message on one line, but don't lose the stack trace — SQL errors deep
  // inside a migration's up() are undiagnosable from the message alone.
  console.error(`Migration failed: ${err instanceof Error ? err.message : err}`);
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
