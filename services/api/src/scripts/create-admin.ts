/**
 * CLI: create or reset a platform superadmin.
 *
 *   node dist/scripts/create-admin.js <email> <password> [firstName] [lastName]
 *   # or via env:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node dist/scripts/create-admin.js
 *
 * In Docker:  docker compose exec api node dist/scripts/create-admin.js admin@example.com 'S3cret!'
 */
import { loadConfig } from '../config.js';
import { initDb, closeDb } from '../db.js';
import { createSuperadmin } from '../bootstrap.js';

async function main(): Promise<void> {
  const [, , argEmail, argPassword, firstName, lastName] = process.argv;
  const email = argEmail ?? process.env.ADMIN_EMAIL;
  const password = argPassword ?? process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Usage: create-admin <email> <password> [firstName] [lastName]');
    console.error('   or: ADMIN_EMAIL=... ADMIN_PASSWORD=... create-admin');
    process.exit(2);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(2);
  }

  const config = loadConfig();
  initDb(config.databaseUrl);
  const id = await createSuperadmin({ email, password, firstName, lastName }, { reset: true });
  await closeDb();

  if (!id) {
    console.error('Failed to create superadmin (see logs).');
    process.exit(1);
  }
  console.log(`✓ Superadmin ready: ${email} (id ${id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
