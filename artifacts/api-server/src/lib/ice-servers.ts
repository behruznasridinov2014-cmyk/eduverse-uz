import { createHmac } from "node:crypto";

/**
 * ICE (STUN/TURN) configuration for live lessons.
 *
 * A TURN relay is what lets two browsers talk when a school network, a mobile
 * carrier or a home router blocks direct peer-to-peer traffic. Credentials stay
 * on the server: the browser asks `/api/ice-servers` for short-lived ones.
 *
 * Providers (set TURN_PROVIDER to pick one explicitly, otherwise the first one
 * whose variables are present is used):
 *
 *   cloudflare  CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN
 *   metered     METERED_TURN_DOMAIN (e.g. myschool.metered.live), METERED_TURN_API_KEY
 *   twilio      TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
 *               (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET instead of the auth token)
 *   static      TURN_URLS (comma separated) + TURN_USERNAME + TURN_CREDENTIAL,
 *               or TURN_URLS + TURN_SHARED_SECRET for a coturn server with
 *               `use-auth-secret` (time-limited credentials are derived here)
 *
 * Optional: TURN_CREDENTIAL_TTL (seconds, default 86400),
 *           TURN_FORCE_RELAY=1 (send all media through TURN, for testing).
 *
 * If the chosen provider fails, the static TURN_URLS server is tried as a
 * backup. With nothing configured the browser uses public STUN only.
 */

export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type TurnProvider = "cloudflare" | "metered" | "twilio" | "static";
export type IceConfig = {
  servers: IceServer[];
  relay: boolean;
  provider: TurnProvider | null;
  iceTransportPolicy: "all" | "relay";
};

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Warn = (details: Record<string, unknown>, message: string) => void;

const PROVIDERS: TurnProvider[] = ["cloudflare", "metered", "twilio", "static"];
const MAX_CACHE_MS = 6 * 60 * 60 * 1000;

function value(env: Env, key: string): string {
  return (env[key] ?? "").trim();
}

export function credentialTtlSeconds(env: Env): number {
  const parsed = Number.parseInt(value(env, "TURN_CREDENTIAL_TTL"), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 86400;
  return Math.min(Math.max(parsed, 600), 172800);
}

export function isProviderConfigured(env: Env, provider: TurnProvider): boolean {
  switch (provider) {
    case "cloudflare":
      return Boolean(value(env, "CLOUDFLARE_TURN_KEY_ID") && value(env, "CLOUDFLARE_TURN_API_TOKEN"));
    case "metered":
      return Boolean(value(env, "METERED_TURN_DOMAIN") && value(env, "METERED_TURN_API_KEY"));
    case "twilio":
      return Boolean(
        value(env, "TWILIO_ACCOUNT_SID") &&
          (value(env, "TWILIO_AUTH_TOKEN") ||
            (value(env, "TWILIO_API_KEY_SID") && value(env, "TWILIO_API_KEY_SECRET"))),
      );
    case "static":
      return Boolean(staticUrls(env).length);
  }
}

/** The provider to use, or null when no TURN relay is configured. */
export function selectProvider(env: Env): TurnProvider | null {
  const wanted = value(env, "TURN_PROVIDER").toLowerCase();
  if (wanted === "none" || wanted === "off") return null;
  if ((PROVIDERS as string[]).includes(wanted)) {
    return isProviderConfigured(env, wanted as TurnProvider) ? (wanted as TurnProvider) : null;
  }
  return PROVIDERS.find((provider) => isProviderConfigured(env, provider)) ?? null;
}

function staticUrls(env: Env): string[] {
  return value(env, "TURN_URLS")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^turns?:/i.test(url));
}

/** Static TURN server, including coturn's shared-secret (TURN REST API) mode. */
export function staticIceServers(env: Env, nowMs = Date.now()): IceServer[] {
  const urls = staticUrls(env);
  if (!urls.length) return [];
  const secret = value(env, "TURN_SHARED_SECRET");
  if (secret) {
    const expiry = Math.floor(nowMs / 1000) + credentialTtlSeconds(env);
    const username = `${expiry}:eduverse`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    return [{ urls, username, credential }];
  }
  const username = value(env, "TURN_USERNAME");
  const credential = value(env, "TURN_CREDENTIAL");
  return [{ urls, ...(username ? { username } : {}), ...(credential ? { credential } : {}) }];
}

function cleanServers(raw: unknown): IceServer[] {
  if (!Array.isArray(raw)) return [];
  const servers: IceServer[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    // Twilio returns both `url` (legacy) and `urls`.
    const urls = record.urls ?? record.url;
    const list = (Array.isArray(urls) ? urls : [urls]).filter(
      (url): url is string => typeof url === "string" && /^(stuns?|turns?):/i.test(url),
    );
    if (!list.length) continue;
    servers.push({
      urls: list.length === 1 ? list[0]! : list,
      ...(typeof record.username === "string" ? { username: record.username } : {}),
      ...(typeof record.credential === "string" ? { credential: record.credential } : {}),
    });
  }
  return servers;
}

async function fetchProvider(
  provider: Exclude<TurnProvider, "static">,
  env: Env,
  fetchImpl: FetchLike,
): Promise<IceServer[]> {
  const ttl = credentialTtlSeconds(env);
  const signal = AbortSignal.timeout(5000);
  if (provider === "cloudflare") {
    const keyId = encodeURIComponent(value(env, "CLOUDFLARE_TURN_KEY_ID"));
    const response = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${value(env, "CLOUDFLARE_TURN_API_TOKEN")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl }),
        signal,
      },
    );
    if (!response.ok) throw new Error(`cloudflare status ${response.status}`);
    const body = (await response.json()) as { iceServers?: unknown };
    return cleanServers(body.iceServers);
  }
  if (provider === "metered") {
    const domain = value(env, "METERED_TURN_DOMAIN").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(value(env, "METERED_TURN_API_KEY"))}`;
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`metered status ${response.status}`);
    return cleanServers(await response.json());
  }
  // Twilio Network Traversal Service.
  const accountSid = value(env, "TWILIO_ACCOUNT_SID");
  const keySid = value(env, "TWILIO_API_KEY_SID");
  const keySecret = value(env, "TWILIO_API_KEY_SECRET");
  const authUser = keySid && keySecret ? keySid : accountSid;
  const authPass = keySid && keySecret ? keySecret : value(env, "TWILIO_AUTH_TOKEN");
  const response = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${authUser}:${authPass}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Ttl: String(ttl) }).toString(),
      signal,
    },
  );
  if (!response.ok) throw new Error(`twilio status ${response.status}`);
  const body = (await response.json()) as { ice_servers?: unknown };
  return cleanServers(body.ice_servers);
}

/** Builds the ICE configuration without caching. */
export async function resolveIceConfig(
  env: Env,
  fetchImpl: FetchLike = fetch,
  warn: Warn = () => {},
  nowMs = Date.now(),
): Promise<IceConfig> {
  const provider = selectProvider(env);
  const policy: IceConfig["iceTransportPolicy"] = value(env, "TURN_FORCE_RELAY") === "1" ? "relay" : "all";
  if (provider && provider !== "static") {
    try {
      const servers = await fetchProvider(provider, env, fetchImpl);
      if (servers.length) return { servers, relay: true, provider, iceTransportPolicy: policy };
      warn({ provider }, "TURN provider returned no ICE servers");
    } catch (error) {
      warn({ provider, err: error }, "TURN credentials request failed");
    }
  }
  const backup = staticIceServers(env, nowMs);
  if (backup.length) return { servers: backup, relay: true, provider: "static", iceTransportPolicy: policy };
  // Forcing relay without a relay would break every call.
  return { servers: [], relay: false, provider: null, iceTransportPolicy: "all" };
}

let cache: { expires: number; config: IceConfig } | null = null;

/** Cached version used by the API route; refreshed well before credentials expire. */
export async function loadIceConfig(env: Env = process.env, warn?: Warn): Promise<IceConfig> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.config;
  const config = await resolveIceConfig(env, fetch, warn, now);
  if (config.relay) {
    const lifetime = Math.min((credentialTtlSeconds(env) * 1000) / 2, MAX_CACHE_MS);
    cache = { expires: now + lifetime, config };
  } else {
    // Retry soon in case the provider was only briefly unreachable.
    cache = { expires: now + 60 * 1000, config };
  }
  return cache.config;
}

export function resetIceCacheForTests(): void {
  cache = null;
}
