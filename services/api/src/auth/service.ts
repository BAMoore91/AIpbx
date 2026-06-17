import { randomUUID } from 'node:crypto';
import { query, queryOne } from '../db.js';
import { sha256Hex } from '../crypto.js';
import { unauthorized, forbidden } from '../errors.js';
import type { UserRow, TenantRow } from '../types/db.js';
import { JwtService } from './jwt.js';
import { verifyPassword } from './passwords.js';
import { verifyTotp } from './mfa.js';

export interface LoginInput {
  email: string;
  password: string;
  totp?: string;
  tenantSlug?: string;
  userAgent?: string;
  ip?: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

// Wire shape sent to the web client. snake_case to match the DB columns and the
// rest of the API's resource payloads (the web `User` type is snake_case); a
// camelCase mismatch here previously left `user.first_name` undefined on the
// client and crashed the app shell after login.
export interface PublicUser {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  mfa_enabled: boolean;
  avatar_url: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    tenant_id: u.tenant_id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    mfa_enabled: u.mfa_enabled,
    avatar_url: u.avatar_url,
    is_active: u.is_active,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly decryptSecret: (v: string | null) => string | null,
  ) {}

  /** Resolve a user by email, optionally constrained to a tenant slug. */
  private async findUser(
    email: string,
    tenantSlug?: string,
  ): Promise<UserRow | null> {
    if (tenantSlug) {
      return queryOne<UserRow>(
        `SELECT u.* FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         WHERE lower(u.email) = lower($1) AND t.slug = $2`,
        [email, tenantSlug],
      );
    }
    // No slug: emails are unique per tenant; pick the first active match.
    return queryOne<UserRow>(
      `SELECT * FROM users WHERE lower(email) = lower($1) AND is_active = true
       ORDER BY created_at LIMIT 1`,
      [email],
    );
  }

  async login(input: LoginInput): Promise<TokenPair> {
    const user = await this.findUser(input.email, input.tenantSlug);
    // Always run a verify to reduce user-enumeration timing differences.
    const ok = await verifyPassword(user?.password_hash, input.password);
    if (!user || !ok) throw unauthorized('Invalid credentials');
    if (!user.is_active) throw forbidden('Account disabled');

    const tenant = await queryOne<TenantRow>(
      `SELECT * FROM tenants WHERE id = $1`,
      [user.tenant_id],
    );
    if (!tenant || !tenant.is_active) throw forbidden('Tenant disabled');

    if (user.mfa_enabled) {
      const secret = this.decryptSecret(user.mfa_secret);
      if (!secret || !input.totp || !verifyTotp(secret, input.totp)) {
        throw unauthorized('MFA code required or invalid');
      }
    }

    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [
      user.id,
    ]);

    return this.issueTokens(user, input.userAgent, input.ip);
  }

  private async issueTokens(
    user: UserRow,
    userAgent?: string,
    ip?: string | null,
  ): Promise<TokenPair> {
    const jti = randomUUID();
    const refreshToken = this.jwt.signRefresh({
      sub: user.id,
      tid: user.tenant_id,
      jti,
    });
    const accessToken = this.jwt.signAccess({
      sub: user.id,
      tid: user.tenant_id,
      role: user.role,
      email: user.email,
    });

    const expiresAt = new Date(
      Date.now() + this.jwt.refreshTtlSeconds * 1000,
    ).toISOString();
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [jti, user.id, sha256Hex(refreshToken), userAgent ?? null, ip ?? null, expiresAt],
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwt.accessTtlSeconds,
      user: toPublicUser(user),
    };
  }

  /** Rotate a refresh token: validate, revoke the old, issue a new pair. */
  async refresh(
    rawToken: string,
    userAgent?: string,
    ip?: string | null,
  ): Promise<TokenPair> {
    let claims;
    try {
      claims = this.jwt.verifyRefresh(rawToken);
    } catch {
      throw unauthorized('Invalid refresh token');
    }

    const stored = await queryOne<{ id: string; revoked_at: string | null }>(
      `SELECT id, revoked_at FROM refresh_tokens
       WHERE id = $1 AND user_id = $2 AND token_hash = $3 AND expires_at > now()`,
      [claims.jti, claims.sub, sha256Hex(rawToken)],
    );
    if (!stored) throw unauthorized('Refresh token not recognized');
    if (stored.revoked_at) {
      // Reuse of an already-rotated token: revoke the whole family.
      await query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [claims.sub],
      );
      throw unauthorized('Refresh token reuse detected');
    }

    const user = await queryOne<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND is_active = true`,
      [claims.sub],
    );
    if (!user) throw unauthorized('User no longer active');

    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [
      stored.id,
    ]);
    return this.issueTokens(user, userAgent, ip);
  }

  /** Revoke a single refresh token (logout). */
  async logout(rawToken: string): Promise<void> {
    try {
      const claims = this.jwt.verifyRefresh(rawToken);
      await query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE id = $1 AND token_hash = $2`,
        [claims.jti, sha256Hex(rawToken)],
      );
    } catch {
      /* idempotent: invalid token is a no-op */
    }
  }

  async me(userId: string): Promise<PublicUser | null> {
    const user = await queryOne<UserRow>(`SELECT * FROM users WHERE id = $1`, [
      userId,
    ]);
    return user ? toPublicUser(user) : null;
  }
}
