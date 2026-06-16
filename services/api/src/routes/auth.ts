import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, requireAuth, clientIp } from './helpers.js';
import { audit } from '../audit.js';
import { notFound, badRequest, AppError } from '../errors.js';
import { query, queryOne } from '../db.js';
import { getRedis } from '../redis.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../auth/mfa.js';
import type { UserRole } from '../types/db.js';

/**
 * Best-effort Redis fixed-window login throttle. Returns true if the request is
 * allowed. Fails open if Redis is unavailable (don't lock everyone out).
 */
async function loginAllowed(key: string, limit = 10, windowSec = 300): Promise<boolean> {
  try {
    const redis = getRedis();
    const k = `rl:login:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true;
  }
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
  tenantSlug: z.string().optional(),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });
const LogoutSchema = z.object({ refreshToken: z.string().min(1) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const body = parse(LoginSchema, request.body);
    // Brute-force throttle, keyed by client IP + email (fixed 5-min window).
    const ip = clientIp(request) ?? 'unknown';
    if (!(await loginAllowed(`${ip}:${body.email.toLowerCase()}`))) {
      throw new AppError(429, 'rate_limited', 'Too many login attempts; try again later');
    }
    const result = await app.ctx.auth.login({
      ...body,
      userAgent: request.headers['user-agent'],
      ip: clientIp(request),
    });
    await audit(
      {
        userId: result.user.id,
        tenantId: result.user.tenantId,
        homeTenantId: result.user.tenantId,
        impersonating: false,
        role: result.user.role as UserRole,
        email: result.user.email,
      },
      { action: 'auth.login', entity: 'user', entityId: result.user.id, ip: clientIp(request) },
    );
    return reply.send(result);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = parse(RefreshSchema, request.body);
    const result = await app.ctx.auth.refresh(
      refreshToken,
      request.headers['user-agent'],
      clientIp(request),
    );
    return reply.send(result);
  });

  app.post('/auth/logout', async (request, reply) => {
    const { refreshToken } = parse(LogoutSchema, request.body);
    await app.ctx.auth.logout(refreshToken);
    return reply.code(204).send();
  });

  app.get(
    '/auth/me',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const me = await app.ctx.auth.me(auth.userId);
      if (!me) throw notFound('User not found');
      return reply.send(me);
    },
  );

  const guard = { preHandler: [app.authenticate] };

  // Update own profile (names + avatar only — email/role are not self-editable).
  app.patch('/auth/me', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        first_name: z.string().trim().max(80).optional(),
        last_name: z.string().trim().max(80).optional(),
        avatar_url: z.string().url().max(2048).optional().nullable(),
      }),
      request.body,
    );
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length) {
      const sets = entries.map(([k], i) => `${k} = $${i + 1}`).concat('updated_at = now()').join(', ');
      await query(
        `UPDATE users SET ${sets} WHERE id = $${entries.length + 1}`,
        [...entries.map(([, v]) => v), auth.userId],
      );
      await audit(auth, { action: 'auth.profile.update', entity: 'user', entityId: auth.userId, ip: clientIp(request) });
    }
    const me = await app.ctx.auth.me(auth.userId);
    return reply.send(me);
  });

  // Change own password (requires the current password).
  app.post('/auth/change-password', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { current_password, new_password } = parse(
      z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(200) }),
      request.body,
    );
    const row = await queryOne<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [auth.userId],
    );
    if (!(await verifyPassword(row?.password_hash ?? null, current_password))) {
      throw badRequest('Current password is incorrect');
    }
    await query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [
      await hashPassword(new_password),
      auth.userId,
    ]);
    // Invalidate other sessions: revoke all refresh tokens for this user.
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [auth.userId]);
    await audit(auth, { action: 'auth.password.change', entity: 'user', entityId: auth.userId, ip: clientIp(request) });
    return reply.send({ ok: true });
  });

  // MFA enrollment: returns a secret + otpauth URI for a QR code (not yet enabled).
  app.post('/auth/mfa/setup', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const secret = generateTotpSecret();
    // Store encrypted but keep mfa_enabled false until verified.
    await query(`UPDATE users SET mfa_secret = $1 WHERE id = $2`, [app.ctx.crypto.encrypt(secret), auth.userId]);
    return reply.send({ secret, otpauth_url: otpauthUrl(secret, auth.email) });
  });

  // Verify a code against the pending secret and enable MFA.
  app.post('/auth/mfa/enable', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), request.body);
    const row = await queryOne<{ mfa_secret: string | null }>(`SELECT mfa_secret FROM users WHERE id = $1`, [auth.userId]);
    const secret = row?.mfa_secret ? app.ctx.crypto.tryDecrypt(row.mfa_secret) : null;
    if (!secret || !verifyTotp(secret, code)) throw badRequest('Invalid code');
    await query(`UPDATE users SET mfa_enabled = true, updated_at = now() WHERE id = $1`, [auth.userId]);
    await audit(auth, { action: 'auth.mfa.enable', entity: 'user', entityId: auth.userId, ip: clientIp(request) });
    return reply.send({ ok: true, mfa_enabled: true });
  });

  // Disable MFA (requires the current password).
  app.post('/auth/mfa/disable', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { password } = parse(z.object({ password: z.string().min(1) }), request.body);
    const row = await queryOne<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [auth.userId]);
    if (!(await verifyPassword(row?.password_hash ?? null, password))) throw badRequest('Password is incorrect');
    await query(`UPDATE users SET mfa_enabled = false, mfa_secret = NULL, updated_at = now() WHERE id = $1`, [auth.userId]);
    await audit(auth, { action: 'auth.mfa.disable', entity: 'user', entityId: auth.userId, ip: clientIp(request) });
    return reply.send({ ok: true, mfa_enabled: false });
  });
}
