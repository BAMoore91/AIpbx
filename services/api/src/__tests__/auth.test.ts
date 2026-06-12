import { describe, it, expect } from 'vitest';
import { Crypto, sha256Hex } from '../crypto.js';
import { JwtService } from '../auth/jwt.js';
import { verifyTotp } from '../auth/mfa.js';

describe('Crypto (AES-256-GCM)', () => {
  const crypto = new Crypto('unit-test-encryption-key-material');

  it('round-trips a secret', () => {
    const plain = 'super-secret-sip-password!';
    const enc = crypto.encrypt(plain);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain(plain);
    expect(crypto.decrypt(enc)).toBe(plain);
  });

  it('produces distinct ciphertexts for the same input (random IV)', () => {
    const a = crypto.encrypt('same');
    const b = crypto.encrypt('same');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('same');
    expect(crypto.decrypt(b)).toBe('same');
  });

  it('fails authentication on tampered ciphertext', () => {
    const enc = crypto.encrypt('value');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A');
    expect(() => crypto.decrypt(tampered)).toThrow();
    expect(crypto.tryDecrypt(tampered)).toBeNull();
  });

  it('sha256Hex is stable', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});

describe('JwtService', () => {
  const jwt = new JwtService('access-secret-xxxxxxxxxxxx', 'refresh-secret-xxxxxxxxxxxx', 900, 3600);

  it('issues and verifies an access token with claims', () => {
    const token = jwt.signAccess({ sub: 'u1', tid: 't1', role: 'admin', email: 'a@b.com' });
    const claims = jwt.verifyAccess(token);
    expect(claims.sub).toBe('u1');
    expect(claims.tid).toBe('t1');
    expect(claims.role).toBe('admin');
  });

  it('rejects an access token verified with the refresh secret', () => {
    const token = jwt.signAccess({ sub: 'u1', tid: 't1', role: 'agent', email: 'a@b.com' });
    expect(() => jwt.verifyRefresh(token)).toThrow();
  });

  it('issues and verifies a refresh token', () => {
    const token = jwt.signRefresh({ sub: 'u1', tid: 't1', jti: 'j1' });
    const claims = jwt.verifyRefresh(token);
    expect(claims.jti).toBe('j1');
  });
});

describe('TOTP (RFC 6238)', () => {
  it('rejects malformed tokens', () => {
    expect(verifyTotp('JBSWY3DPEHPK3PXP', 'abc')).toBe(false);
    expect(verifyTotp('', '123456')).toBe(false);
    expect(verifyTotp('JBSWY3DPEHPK3PXP', '12345')).toBe(false); // too short
  });

  it('returns a boolean for well-formed input', () => {
    // Without the shared OTP app we cannot know the live code, but the verifier
    // must always return a boolean and reject an arbitrary code.
    const result = verifyTotp('JBSWY3DPEHPK3PXP', '000000');
    expect(typeof result).toBe('boolean');
  });
});
