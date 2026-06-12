import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';

/**
 * AES-256-GCM authenticated encryption for secrets at rest
 * (SIP/trunk passwords). The ENCRYPTION_KEY env var supplies the key.
 *
 * Wire format (base64): [12-byte IV][16-byte auth tag][ciphertext]
 * A short version prefix ("v1:") lets us rotate algorithms later.
 */

const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derive a 32-byte key from the configured ENCRYPTION_KEY.
 * Accepts a base64 32-byte key directly, otherwise SHA-256 hashes the
 * provided material to a deterministic 32-byte key.
 */
function deriveKey(material: string): Buffer {
  try {
    const decoded = Buffer.from(material, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    /* fall through to hash */
  }
  return createHash('sha256').update(material, 'utf8').digest();
}

export class Crypto {
  private readonly key: Buffer;

  constructor(keyMaterial: string) {
    if (!keyMaterial) throw new Error('ENCRYPTION_KEY is required for Crypto');
    this.key = deriveKey(keyMaterial);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, ciphertext]).toString('base64');
    return `${VERSION}:${payload}`;
  }

  decrypt(value: string): string {
    const [version, payload] = value.split(':', 2);
    if (version !== VERSION || !payload) {
      throw new Error('Unsupported or malformed ciphertext');
    }
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Best-effort decrypt that returns null instead of throwing. */
  tryDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      return this.decrypt(value);
    } catch {
      return null;
    }
  }
}

/** Stable SHA-256 hex digest (used for opaque token lookup). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
