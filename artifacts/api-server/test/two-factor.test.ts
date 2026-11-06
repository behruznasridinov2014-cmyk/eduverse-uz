import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptSecret,
  encryptSecret,
  decryptSecretWithKey,
  encryptSecretWithKey,
  generateRecoveryCodes,
  hashRecoveryCode,
  hashChallengeToken,
  totp,
  verifyTotp,
  verifyTotpStep,
} from "../src/lib/two-factor.ts";

describe("two-factor helpers", () => {
  it("matches the RFC 6238 SHA-1 test vector", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    assert.equal(totp(secret, 59_000), "287082");
    assert.equal(verifyTotp(secret, "287082", 59_000), true);
    assert.equal(verifyTotpStep(secret, "287082", 59_000), 1);
    assert.equal(verifyTotp(secret, "287083", 59_000), false);
    assert.equal(verifyTotpStep(secret, "287082", 120_000), null);
  });

  it("encrypts secrets and rejects modified ciphertext", () => {
    const encrypted = encryptSecret("secret-value");
    const parts = encrypted.split("$");
    const tag = parts[2]!;
    parts[2] = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;

    assert.notEqual(encrypted, "secret-value");
    assert.equal(decryptSecret(encrypted), "secret-value");
    assert.throws(() => decryptSecret(parts.join("$")));
  });

  it("supports verified re-encryption with a separate rotation key", () => {
    const oldKey = "12".repeat(32);
    const newKey = "34".repeat(32);
    const encrypted = encryptSecretWithKey("rotation-test", oldKey);
    const reencrypted = encryptSecretWithKey(
      decryptSecretWithKey(encrypted, oldKey),
      newKey,
    );

    assert.notEqual(encrypted, reencrypted);
    assert.equal(decryptSecretWithKey(reencrypted, newKey), "rotation-test");
    assert.throws(() => decryptSecretWithKey(encrypted, newKey));
  });

  it("creates distinct one-time recovery codes and normalized hashes", () => {
    const codes = generateRecoveryCodes();

    assert.equal(codes.length, 8);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(hashRecoveryCode(codes[0]!), hashRecoveryCode(codes[0]!.replaceAll("-", "")));
  });

  it("hashes challenge tokens instead of storing them directly", () => {
    assert.notEqual(hashChallengeToken("challenge-token"), "challenge-token");
    assert.equal(hashChallengeToken("challenge-token"), hashChallengeToken("challenge-token"));
  });
});
