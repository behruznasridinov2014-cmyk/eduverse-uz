import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  credentialTtlSeconds,
  resolveIceConfig,
  selectProvider,
  staticIceServers,
} from "../src/lib/ice-servers.ts";

type Call = { url: string; init?: RequestInit };

function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

describe("TURN provider selection", () => {
  it("returns null when nothing is configured", () => {
    assert.equal(selectProvider({}), null);
  });

  it("auto-detects the first configured provider", () => {
    assert.equal(selectProvider({ METERED_TURN_DOMAIN: "x.metered.live", METERED_TURN_API_KEY: "k" }), "metered");
    assert.equal(selectProvider({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }), "twilio");
    assert.equal(selectProvider({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY_SID: "SK", TWILIO_API_KEY_SECRET: "s" }), "twilio");
    assert.equal(selectProvider({ TURN_URLS: "turn:turn.example.org:3478" }), "static");
  });

  it("honours TURN_PROVIDER and refuses a half-configured one", () => {
    const env = {
      TURN_PROVIDER: "static",
      TURN_URLS: "turn:turn.example.org:3478",
      CLOUDFLARE_TURN_KEY_ID: "id",
      CLOUDFLARE_TURN_API_TOKEN: "tok",
    };
    assert.equal(selectProvider(env), "static");
    assert.equal(selectProvider({ TURN_PROVIDER: "metered", METERED_TURN_DOMAIN: "x" }), null);
    assert.equal(selectProvider({ ...env, TURN_PROVIDER: "none" }), null);
  });

  it("clamps the credential lifetime", () => {
    assert.equal(credentialTtlSeconds({}), 86400);
    assert.equal(credentialTtlSeconds({ TURN_CREDENTIAL_TTL: "5" }), 600);
    assert.equal(credentialTtlSeconds({ TURN_CREDENTIAL_TTL: "abc" }), 86400);
  });
});

describe("static TURN servers", () => {
  it("uses fixed credentials and ignores non-TURN urls", () => {
    const servers = staticIceServers({
      TURN_URLS: "turn:a.example.org:3478, https://bad , turns:a.example.org:5349",
      TURN_USERNAME: "u",
      TURN_CREDENTIAL: "p",
    });
    assert.deepEqual(servers, [
      { urls: ["turn:a.example.org:3478", "turns:a.example.org:5349"], username: "u", credential: "p" },
    ]);
  });

  it("derives coturn shared-secret credentials", () => {
    const now = 1_700_000_000_000;
    const [server] = staticIceServers(
      { TURN_URLS: "turn:a.example.org:3478", TURN_SHARED_SECRET: "s3cret", TURN_CREDENTIAL_TTL: "3600" },
      now,
    );
    const username = `${1_700_000_000 + 3600}:eduverse`;
    assert.equal(server?.username, username);
    assert.equal(server?.credential, createHmac("sha1", "s3cret").update(username).digest("base64"));
  });
});

describe("dynamic TURN providers", () => {
  it("requests Cloudflare credentials", async () => {
    const { impl, calls } = fakeFetch({
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478"], username: "u", credential: "c" }],
    });
    const config = await resolveIceConfig({ CLOUDFLARE_TURN_KEY_ID: "key", CLOUDFLARE_TURN_API_TOKEN: "tok" }, impl);
    assert.equal(config.provider, "cloudflare");
    assert.equal(config.relay, true);
    assert.match(calls[0]!.url, /\/turn\/keys\/key\/credentials\/generate-ice-servers$/);
    assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer tok");
  });

  it("requests Metered credentials", async () => {
    const { impl, calls } = fakeFetch([
      { urls: "stun:stun.relay.metered.ca:80" },
      { urls: "turn:global.relay.metered.ca:80", username: "u", credential: "c" },
    ]);
    const config = await resolveIceConfig(
      { METERED_TURN_DOMAIN: "https://myschool.metered.live/", METERED_TURN_API_KEY: "k&1" },
      impl,
    );
    assert.equal(config.provider, "metered");
    assert.equal(config.servers.length, 2);
    assert.equal(calls[0]!.url, "https://myschool.metered.live/api/v1/turn/credentials?apiKey=k%261");
  });

  it("requests Twilio tokens with an API key and maps legacy fields", async () => {
    const { impl, calls } = fakeFetch({
      ice_servers: [
        { url: "stun:global.stun.twilio.com:3478", urls: "stun:global.stun.twilio.com:3478" },
        { url: "turn:global.turn.twilio.com:3478?transport=udp", username: "u", credential: "c" },
      ],
    });
    const config = await resolveIceConfig(
      { TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "sec" },
      impl,
    );
    assert.equal(config.provider, "twilio");
    assert.deepEqual(config.servers[1], {
      urls: "turn:global.turn.twilio.com:3478?transport=udp",
      username: "u",
      credential: "c",
    });
    assert.equal(calls[0]!.url, "https://api.twilio.com/2010-04-01/Accounts/AC1/Tokens.json");
    const auth = (calls[0]!.init?.headers as Record<string, string>).authorization;
    assert.equal(auth, `Basic ${Buffer.from("SK1:sec").toString("base64")}`);
    assert.equal(calls[0]!.init?.body, "Ttl=86400");
  });

  it("falls back to the static server when the provider fails", async () => {
    const { impl } = fakeFetch({ error: "nope" }, 401);
    const warnings: string[] = [];
    const config = await resolveIceConfig(
      {
        CLOUDFLARE_TURN_KEY_ID: "key",
        CLOUDFLARE_TURN_API_TOKEN: "bad",
        TURN_URLS: "turn:backup.example.org:3478",
        TURN_USERNAME: "u",
        TURN_CREDENTIAL: "p",
      },
      impl,
      (_details, message) => warnings.push(message),
    );
    assert.equal(config.provider, "static");
    assert.equal(warnings.length, 1);
  });

  it("never forces relay mode without a relay", async () => {
    const config = await resolveIceConfig({ TURN_FORCE_RELAY: "1" });
    assert.deepEqual(config, { servers: [], relay: false, provider: null, iceTransportPolicy: "all" });
    const forced = await resolveIceConfig({ TURN_FORCE_RELAY: "1", TURN_URLS: "turn:a.example.org:3478" });
    assert.equal(forced.iceTransportPolicy, "relay");
  });
});
