import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskEmail, maskUsername } from "../src/lib/mailer.ts";

describe("forgot password: half-hidden contacts", () => {
  it("keeps the start and the end of an e-mail", () => {
    assert.equal(maskEmail("behruz2014@gmail.com"), "be****14@gmail.com");
    assert.equal(maskEmail("ab@mail.ru"), "a****@mail.ru");
    assert.equal(maskEmail("not-an-email"), "");
  });
  it("keeps the first half of a Telegram name", () => {
    assert.equal(maskUsername("behruz_n"), "@behr****");
    assert.equal(maskUsername("@ab"), "@a****");
  });
});
