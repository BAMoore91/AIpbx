import { createHmac, randomBytes } from 'node:crypto';

/**
 * Minimal TOTP (RFC 6238) verifier — used as the optional MFA second factor.
 * The shared secret is a base32 string stored (encrypted) in users.mfa_secret.
 *
 * This is a self-contained implementation so the service has no extra runtime
 * dependency for MFA. Enrollment (QR provisioning URI) is left as a TODO for
 * the admin UI; verification is what the login flow needs.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Generate a new base32 TOTP secret (160 bits) for enrollment. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Build the otpauth:// provisioning URI for an authenticator-app QR code. */
export function otpauthUrl(secret: string, account: string, issuer = 'AIpbx'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  // write 64-bit counter big-endian (high word is 0 for realistic counters)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Verify a TOTP code against a base32 secret, allowing +/- one 30s step of
 * clock drift.
 */
export function verifyTotp(
  base32Secret: string,
  token: string,
  step = 30,
  window = 1,
): boolean {
  if (!base32Secret || !/^\d{6}$/.test(token.trim())) return false;
  const secret = base32Decode(base32Secret);
  const counter = Math.floor(Date.now() / 1000 / step);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    if (hotp(secret, counter + errorWindow) === token.trim()) return true;
  }
  return false;
}
