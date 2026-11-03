import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../src/lib/auth-crypto.ts";

describe("authentication cryptography helpers", () => {
  it("hashes passwords with a unique salt and verifies only the original", async () => {
    const firstHash = await hashPassword("correct horse battery staple");
    const secondHash = await hashPassword("correct horse battery staple");

    assert.notEqual(firstHash, secondHash);
    assert.equal(
      await verifyPassword("correct horse battery staple", firstHash),
      true,
    );
    assert.equal(await verifyPassword("not the password", firstHash), false);
  });

  it("rejects malformed or unsupported password hashes", async () => {
    assert.equal(await verifyPassword("password", "invalid"), false);
    assert.equal(
      await verifyPassword("password", "scrypt$1$1$1$bad$bad"),
      false,
    );
  });

  it("creates unpredictable session tokens and stores only their digest", () => {
    const firstToken = createSessionToken();
    const secondToken = createSessionToken();

    assert.notEqual(firstToken, secondToken);
    assert.notEqual(firstToken, hashSessionToken(firstToken));
    assert.equal(hashSessionToken(firstToken), hashSessionToken(firstToken));
  });
});
