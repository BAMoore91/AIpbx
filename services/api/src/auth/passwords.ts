import argon2 from 'argon2';
import { randomInt } from 'node:crypto';

/**
 * Argon2id password hashing. Parameters are sane defaults for an interactive
 * login flow; tune memoryCost for your hardware if needed.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // ~19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Generate a strong, human-shareable temporary password. Uses an unambiguous
 * alphabet (no 0/O/1/l/I) so it survives being read aloud or copied.
 */
export function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export async function verifyPassword(
  hash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
