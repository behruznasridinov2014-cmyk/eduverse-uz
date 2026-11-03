import assert from "node:assert/strict";
import { test } from "node:test";
import { customFetch } from "../src/custom-fetch.ts";

test("includes cookie credentials for browser session authentication", async () => {
  const originalFetch = globalThis.fetch;
  let credentials: RequestCredentials | undefined;

  globalThis.fetch = async (_input, init) => {
    credentials = init?.credentials;
    return Response.json({ ok: true });
  };

  try {
    await customFetch("/api/auth/me");
    assert.equal(credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves an explicitly selected credentials mode", async () => {
  const originalFetch = globalThis.fetch;
  let credentials: RequestCredentials | undefined;

  globalThis.fetch = async (_input, init) => {
    credentials = init?.credentials;
    return Response.json({ ok: true });
  };

  try {
    await customFetch("/api/healthz", { credentials: "omit" });
    assert.equal(credentials, "omit");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
