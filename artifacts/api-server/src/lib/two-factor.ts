/**
 * Two-factor authentication core (Steam-Guard / Telegram style).
 *
 * - TOTP (RFC 6238, HMAC-SHA1, 30 s step, 6 digits) — works with the Telegram
 *   bot that delivers the code, and with any authenticator app.
 * - Secrets are stored AES-256-GCM encrypted (`TWO_FACTOR_ENCRYPTION_KEY`, a
 *   64-char hex key). In development an ephemeral key is generated instead so
 *   nothing is stored unencrypted and nothing long-lived leaks.
 * - Recovery codes are 8-char random codes, stored as SHA-256 digests and
 *   single-use.
 * - Challenges (issued after a correct password) live 5 minutes and are stored
 *   as SHA-256 digests.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO_PREFIX = "v1";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

function readEncryptionKey(): Buffer | null {
  const hex = (process.env.TWO_FACTOR_ENCRYPTION_KEY ?? "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  return null;
}

function encryptionKeyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Two-factor encryption keys must be 64 hexadecimal characters.");
  }
  return Buffer.from(hex, "hex");
}

let ephemeralKey: Buffer | null = null;

function encryptionKey(): Buffer {
  const key = readEncryptionKey();
  if (key) return key;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY must be set to a 64-character hex key when NODE_ENV=production. Generate one with `openssl rand -hex 32`.",
    );
  }
  if (!ephemeralKey) ephemeralKey = randomBytes(32);
  return ephemeralKey;
}

export function twoFactorKeyIsConfigured(): boolean {
  return readEncryptionKey() !== null;
}

/* -------------------------------------------------------------------------- */
/* AES-256-GCM                                                               */
/* -------------------------------------------------------------------------- */

export function encryptSecret(plain: string): string {
  return encryptSecretWithBuffer(plain, encryptionKey());
}

export function encryptSecretWithKey(plain: string, keyHex: string): string {
  return encryptSecretWithBuffer(plain, encryptionKeyFromHex(keyHex));
}

function encryptSecretWithBuffer(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ALGO_PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join("$");
}

export function decryptSecret(encoded: string): string {
  return decryptSecretWithBuffer(encoded, encryptionKey());
}

export function decryptSecretWithKey(encoded: string, keyHex: string): string {
  return decryptSecretWithBuffer(encoded, encryptionKeyFromHex(keyHex));
}

function decryptSecretWithBuffer(encoded: string, key: Buffer): string {
  const parts = encoded.split("$");
  if (parts.length === 4 && parts[0] === ALGO_PREFIX) {
    const [, iv, tag, ciphertext] = parts as [string, string, string, string];
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }
  // legacy/plain passthrough not allowed: fail closed
  throw new Error("Unrecognised two-factor secret encoding.");
}

/* -------------------------------------------------------------------------- */
/* Base32 + RFC 6238                                                          */
/* -------------------------------------------------------------------------- */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
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

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buffer[i] = value & 255;
    value = Math.floor(value / 256);
  }
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 15;
  const code =
    (((digest[offset]! & 127) << 24) |
      ((digest[offset + 1]! & 255) << 16) |
      ((digest[offset + 2]! & 255) << 8) |
      (digest[offset + 3]! & 255)) %
    1_000_000;
  return String(code).padStart(TOTP_DIGITS, "0");
}

export function totp(secretBase32: string, timeMs = Date.now()): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(secret, counter);
}

/** Verify a code, accepting ±1 time step for clock skew. */
export function verifyTotp(secretBase32: string, code: string, timeMs = Date.now()): boolean {
  return verifyTotpStep(secretBase32, code, timeMs) !== null;
}

/** Returns the matching TOTP time step so callers can prevent code replay. */
export function verifyTotpStep(secretBase32: string, code: string, timeMs = Date.now()): number | null {
  const normalised = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalised)) return null;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const step = counter + offset;
    const expected = hotp(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalised))) return step;
  }
  return null;
}

/** Generates a fresh 160-bit secret for a new 2FA enrollment. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpauthUrl(secretBase32: string, label: string, issuer = "EDUVERSE-UZ"): string {
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Recovery codes (SHA-256 digests, single-use)                                */
/* -------------------------------------------------------------------------- */

const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_BYTES = 6;

export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const raw = randomBytes(RECOVERY_CODE_BYTES).toString("hex");
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replace(/[-\s]/g, "").toLowerCase()).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Challenge tokens                                                            */
/* -------------------------------------------------------------------------- */

export function createChallengeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
