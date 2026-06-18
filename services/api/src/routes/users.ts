import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { audit } from '../audit.js';
import { conflict, notFound } from '../errors.js';
import { hashPassword, generatePassword } from '../auth/passwords.js';
import {
  parse,
  requireAuth,
  PaginationQuery,
  paginate,
  offset,
  created,
  clientIp,
} from './helpers.js';
import { userCreate, userUpdate, userProvision } from './schemas.js';
import type { UserRow } from '../types/db.js';

const publicCols =
  'id, tenant_id, email, first_name, last_name, role, mfa_enabled, avatar_url, is_active, last_login_at, created_at, updated_at';

/** User management — separate from generic CRUD because of password hashing. */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  const writeGuard = { preHandler: [app.authenticate, app.requireRole('admin')] };
  const readGuard = { preHandler: [app.authenticate] };

  app.get('/users', readGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { page, pageSize } = parse(PaginationQuery, request.query);
    const rows = await query(
      `SELECT ${publicCols} FROM users WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [auth.tenantId, pageSize, offset(page, pageSize)],
    );
    const count = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE tenant_id = $1`,
      [auth.tenantId],
    );
    return reply.send(paginate(rows.rows, Number(count?.count ?? 0), page, pageSize));
  });

  app.get('/users/:id', readGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `SELECT ${publicCols} FROM users WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, id],
    );
    if (!row) throw notFound('User not found');
    return reply.send(row);
  });

  app.post('/users', writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const data = parse(userCreate, request.body);
    const existing = await queryOne<UserRow>(
      `SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)`,
      [auth.tenantId, data.email],
    );
    if (existing) throw conflict('A user with that email already exists');

    const hash = await hashPassword(data.password);
    const row = await queryOne(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${publicCols}`,
      [auth.tenantId, data.email, hash, data.first_name ?? null, data.last_name ?? null, data.role, data.is_active],
    );
    await audit(auth, { action: 'users.create', entity: 'user', entityId: String(row!.id), ip: clientIp(request) });
    return created(reply, row);
  });

  // Provision (create-or-link) a web user for an extension, returning a
  // generated password to display once, or emailing an invite. Used by the
  // "associate a web user" option in the extension form.
  app.post('/users/provision', writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const data = parse(userProvision, request.body);
    const email = data.email.trim().toLowerCase();

    let user = await queryOne<{
      id: string; email: string; first_name: string | null; last_name: string | null; role: string;
    }>(
      `SELECT id, email, first_name, last_name, role FROM users WHERE tenant_id = $1 AND lower(email) = $2`,
      [auth.tenantId, email],
    );

    let generated: string | null = null;
    const linkedExisting = Boolean(user);

    if (!user) {
      generated = generatePassword();
      user = await queryOne(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         RETURNING id, email, first_name, last_name, role`,
        [auth.tenantId, email, await hashPassword(generated), data.first_name ?? null, data.last_name ?? null, data.role],
      );
      await audit(auth, { action: 'users.create', entity: 'user', entityId: String(user!.id), ip: clientIp(request) });
    }

    // Optionally link the extension to this user.
    if (data.extension_id) {
      const linked = await queryOne(
        `UPDATE extensions SET user_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id`,
        [user!.id, data.extension_id, auth.tenantId],
      );
      if (!linked) throw notFound('Extension not found');
    }

    // Invite mode: email the new user a login link + temporary password.
    let emailSent = false;
    let temporaryPassword: string | null = null;
    if (data.mode === 'invite' && generated) {
      const cfg = app.ctx.config;
      const base = cfg.corsOrigins[0] ?? (cfg.domain ? `https://${cfg.domain}` : '');
      if (app.ctx.email.enabled) {
        try {
          await app.ctx.email.send({
            to: email,
            subject: 'Your AIpbx account is ready',
            text:
              `An account was created for you on AIpbx.\n\n` +
              `Sign in: ${base || '(ask your administrator for the URL)'}/login\n` +
              `Email: ${email}\n` +
              `Temporary password: ${generated}\n\n` +
              `Please sign in and change your password under Settings → Security.`,
          });
          emailSent = true;
        } catch {
          emailSent = false;
        }
      }
      // If we couldn't email it, hand the temp password back so the admin can deliver it.
      if (!emailSent) temporaryPassword = generated;
    }

    await audit(auth, { action: 'users.provision', entity: 'user', entityId: String(user!.id), ip: clientIp(request) });

    return reply.send({
      user: { id: user!.id, email: user!.email, first_name: user!.first_name, last_name: user!.last_name, role: user!.role },
      linkedExisting,
      mode: data.mode,
      // Only surface a password when we actually created one and aren't emailing it.
      generatedPassword: data.mode === 'generate' ? generated : null,
      invited: data.mode === 'invite' && !linkedExisting,
      emailSent,
      temporaryPassword,
    });
  });

  app.patch('/users/:id', writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const data = parse(userUpdate, request.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };
    if (data.first_name !== undefined) set('first_name', data.first_name);
    if (data.last_name !== undefined) set('last_name', data.last_name);
    if (data.role !== undefined) set('role', data.role);
    if (data.is_active !== undefined) set('is_active', data.is_active);
    if (data.avatar_url !== undefined) set('avatar_url', data.avatar_url);
    if (data.mfa_enabled !== undefined) set('mfa_enabled', data.mfa_enabled);
    if (data.password !== undefined) set('password_hash', await hashPassword(data.password));
    set('updated_at', new Date().toISOString());

    const row = await queryOne(
      `UPDATE users SET ${sets.join(', ')} WHERE tenant_id = $${i++} AND id = $${i} RETURNING ${publicCols}`,
      [...params, auth.tenantId, id],
    );
    if (!row) throw notFound('User not found');
    await audit(auth, { action: 'users.update', entity: 'user', entityId: id, ip: clientIp(request) });
    return reply.send(row);
  });

  app.delete('/users/:id', writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `DELETE FROM users WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [auth.tenantId, id],
    );
    if (!row) throw notFound('User not found');
    await audit(auth, { action: 'users.delete', entity: 'user', entityId: id, ip: clientIp(request) });
    return reply.code(204).send();
  });
}
