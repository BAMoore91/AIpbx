import { query, queryOne } from './db.js';
import { logger } from './logger.js';
import { hashPassword } from './auth/passwords.js';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface BootstrapAdminInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  tenantId?: string;
}

/**
 * Create a platform superadmin so the console is usable on first deploy.
 *   - ensures the default tenant exists,
 *   - if the user exists: when `reset` is true (CLI), reset password + ensure
 *     superadmin/active; when false (startup bootstrap), leave it UNCHANGED so a
 *     rotated password / deliberate deactivation isn't clobbered on every boot,
 *   - otherwise creates the superadmin.
 * Returns the user id, or null on failure (logged).
 */
export async function createSuperadmin(
  input: BootstrapAdminInput,
  opts: { reset?: boolean } = {},
): Promise<string | null> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const email = input.email.trim().toLowerCase();
  try {
    await query(
      `INSERT INTO tenants (id, name, slug, plan, max_extensions, max_concurrent_calls)
       VALUES ($1, 'Default', 'default', 'enterprise', 500, 200)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );
    const hash = await hashPassword(input.password);
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = $2`,
      [tenantId, email],
    );
    if (existing) {
      if (opts.reset) {
        await query(
          `UPDATE users SET password_hash = $1, role = 'superadmin', is_active = true, updated_at = now()
           WHERE id = $2`,
          [hash, existing.id],
        );
        logger.info({ email, userId: existing.id }, 'superadmin reset (password + role)');
      } else {
        logger.info({ email, userId: existing.id }, 'superadmin already exists; left unchanged');
      }
      return existing.id;
    }
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, 'superadmin', true) RETURNING id`,
      [tenantId, email, hash, input.firstName ?? 'Admin', input.lastName ?? 'User'],
    );
    logger.info({ email, userId: row?.id }, 'superadmin created');
    return row?.id ?? null;
  } catch (err) {
    logger.error({ err: (err as Error).message, email }, 'createSuperadmin failed');
    return null;
  }
}

/**
 * Startup hook: if BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD are set,
 * ensure that superadmin exists. Lets a fresh deploy log in with no manual SQL.
 * No-op when the env vars are absent.
 */
export async function bootstrapAdminFromEnv(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  await createSuperadmin({ email, password });
}
