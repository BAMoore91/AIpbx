import jwt, { type SignOptions } from 'jsonwebtoken';
import type { UserRole } from '../types/db.js';

export interface AccessTokenClaims {
  sub: string; // user id
  tid: string; // tenant id
  role: UserRole;
  email: string;
}

export interface RefreshTokenClaims {
  sub: string; // user id
  tid: string;
  jti: string; // unique token id; the raw token hash is stored in refresh_tokens
}

export class JwtService {
  constructor(
    private readonly accessSecret: string,
    private readonly refreshSecret: string,
    private readonly accessTtl: number,
    private readonly refreshTtl: number,
  ) {}

  signAccess(claims: AccessTokenClaims): string {
    const opts: SignOptions = { expiresIn: this.accessTtl, algorithm: 'HS256' };
    return jwt.sign(claims, this.accessSecret, opts);
  }

  signRefresh(claims: RefreshTokenClaims): string {
    const opts: SignOptions = { expiresIn: this.refreshTtl, algorithm: 'HS256' };
    return jwt.sign(claims, this.refreshSecret, opts);
  }

  verifyAccess(token: string): AccessTokenClaims {
    return jwt.verify(token, this.accessSecret, {
      algorithms: ['HS256'],
    }) as AccessTokenClaims;
  }

  verifyRefresh(token: string): RefreshTokenClaims {
    return jwt.verify(token, this.refreshSecret, {
      algorithms: ['HS256'],
    }) as RefreshTokenClaims;
  }

  get accessTtlSeconds(): number {
    return this.accessTtl;
  }

  get refreshTtlSeconds(): number {
    return this.refreshTtl;
  }
}
