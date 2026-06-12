import argon2 from 'argon2';

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
