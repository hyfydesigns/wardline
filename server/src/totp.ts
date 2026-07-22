import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP (time-based one-time passwords), implemented on node:crypto —
 * no dependency. Compatible with Google Authenticator, 1Password, Authy, etc.
 *
 * Pure and side-effect free so it can be unit-tested against the RFC vectors.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Encode bytes as unpadded base32 (the format authenticator apps expect). */
export function base32Encode(buf: Buffer): string {
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

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a new base32 secret (160-bit, the RFC-recommended size for SHA-1). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Compute the TOTP code for a given counter (time step). */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Write the counter as a 64-bit big-endian integer.
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The current expected code for a base32 secret. */
export function generateTotp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verify a submitted code, allowing `window` steps of clock drift either way
 * (default ±1 step = ±30s). Comparison is constant-time.
 */
export function verifyTotp(secretBase32: string, token: string, atMs: number = Date.now(), window = 1): boolean {
  const cleaned = (token ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  const submitted = Buffer.from(cleaned);
  for (let drift = -window; drift <= window; drift++) {
    const expected = Buffer.from(hotp(secret, counter + drift));
    if (expected.length === submitted.length && timingSafeEqual(expected, submitted)) return true;
  }
  return false;
}

/** otpauth:// URI an authenticator app can scan as a QR code. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'Wardline'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
