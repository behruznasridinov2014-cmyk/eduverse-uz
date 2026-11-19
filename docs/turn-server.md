# TURN server for online lessons

Live lessons (**Onlayn dars**) are a WebRTC mesh: camera, microphone and screen
share go directly between the browsers, and only the offer/answer and ICE
candidates travel through the API.

A direct connection works on most home and school networks thanks to STUN. It
fails when a network blocks UDP or peer-to-peer traffic: strict school or
office firewalls, some mobile carriers, and symmetric NAT. In that case the
media has to be **relayed through a TURN server**. Without one, those students
see "connecting…" forever. Expect roughly 10–20% of connections to need a relay.

## How it works in the app

1. When a lesson room opens, the browser calls `GET /api/ice-servers` (signed-in
   users only) and waits up to 4 seconds for the answer before it connects to
   anyone.
2. The API reads the TURN settings from its **server** environment variables,
   asks the provider for short-lived credentials, caches them (half their
   lifetime, at most 6 hours) and returns them.
3. The browser uses public STUN plus the returned TURN servers. Credentials
   never appear in the JavaScript bundle.
4. If nothing is configured, the browser falls back to public STUN and the
   rate-limited public relay `openrelay.metered.ca`. That is fine for a demo
   and is **not** enough for a full class.

The code is in `artifacts/api-server/src/lib/ice-servers.ts` (providers, tests
in `artifacts/api-server/test/ice-servers.test.ts`) and
`artifacts/eduverse-uz/src/lesson-mesh.ts` (browser side).

## What to buy: pick one provider

Prices checked November 2026; confirm on the provider's page before buying.

| Provider | Price | Free allowance | Good for |
| --- | --- | --- | --- |
| **Cloudflare Realtime TURN** (recommended) | $0.05 per GB | First 1,000 GB per month (shared with Cloudflare SFU) | Cheapest by far; global network |
| **Metered** | Growth plan $99/month incl. 150 GB, then $0.40/GB | 0.5 GB per month | Simple dashboard, TURN over 443/TLS |
| **Twilio Network Traversal** | $0.40/GB (US/EU), $0.60/GB (Asia) | None listed (trial credit only) | If you already use Twilio |
| **Own coturn server** | Cost of a VPS (from ~$5–10/month) + its traffic | – | Full control; you run and update it |

Rough traffic: one relayed video stream uses about 0.5–1 GB per hour. Because
the lesson is a mesh, every relayed participant relays one stream per other
participant, so a 30-student lesson with a few blocked students can relay
tens of GB per hour. Cloudflare's free 1,000 GB covers a lot of lessons.

Sources: [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/pricing/),
[Metered pricing](https://metered.ca/pricing),
[Twilio Network Traversal pricing](https://www.twilio.com/en-us/stun-turn/pricing).

## What to set

Set these on the **API server** (Vercel project → Settings → Environment
Variables, or the API container's environment). They are runtime variables; no
rebuild of the web app is needed, but redeploy/restart the API afterwards.
Never commit real values.

### Cloudflare (recommended)

1. Cloudflare dashboard → **Realtime** → **TURN Server** → **Create TURN key**.
2. Copy the **Turn Token ID** and the **API Token** (shown once).
3. Set:

```
CLOUDFLARE_TURN_KEY_ID=<Turn Token ID>
CLOUDFLARE_TURN_API_TOKEN=<API Token>
```

### Metered

1. Sign up at metered.ca, create a TURN app; note your app domain
   (e.g. `myschool.metered.live`).
2. Dashboard → **TURN Server** → **API Keys** → create a key.
3. Set:

```
METERED_TURN_DOMAIN=myschool.metered.live
METERED_TURN_API_KEY=<API key>
```

### Twilio

1. Twilio console → copy the **Account SID**.
2. Preferably create an **API key** (Account → API keys) instead of using the
   main auth token.
3. Set:

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=<secret>
# or, instead of the API key: TWILIO_AUTH_TOKEN=<auth token>
```

### Own coturn server (or any static TURN)

Fixed username/password:

```
TURN_URLS=turn:turn.example.uz:3478,turns:turn.example.uz:5349
TURN_USERNAME=<user>
TURN_CREDENTIAL=<password>
```

Or, safer, coturn with `use-auth-secret` and `static-auth-secret=<secret>` in
`turnserver.conf`; the API then derives credentials that expire:

```
TURN_URLS=turn:turn.example.uz:3478,turns:turn.example.uz:5349
TURN_SHARED_SECRET=<same secret as static-auth-secret>
```

Open UDP/TCP 3478, TCP 5349 (TLS) and the relay port range (default
49152–65535 UDP) in the server firewall.

### Optional settings

| Variable | Meaning |
| --- | --- |
| `TURN_PROVIDER` | `cloudflare`, `metered`, `twilio`, `static` or `none`. Without it, the first configured provider in that order is used. |
| `TURN_CREDENTIAL_TTL` | Credential lifetime in seconds (default 86400, allowed 600–172800). |
| `TURN_FORCE_RELAY=1` | Send all media through TURN. Only for testing that the relay works; turn it off again afterwards. |

If a provider (Cloudflare, Metered, Twilio) fails, the static `TURN_URLS`
server is used as a backup when it is also set.

The old build-time variables `VITE_TURN_URL`, `VITE_TURN_USERNAME` and
`VITE_TURN_CREDENTIAL` still work but put the password into the public
JavaScript bundle. Prefer the server variables above and remove the `VITE_`
ones once they are set.

## Check that it works

1. Sign in and open `https://<your-site>/api/ice-servers`. You should see
   `"relay": true` and your provider name, e.g. `"provider": "cloudflare"`.
2. Temporarily set `TURN_FORCE_RELAY=1`, redeploy the API, and join a lesson
   from two devices on different networks (for example a phone on mobile data
   and a laptop on Wi-Fi). If video and sound work, the relay works. In Chrome,
   `chrome://webrtc-internals` shows candidate type `relay`.
3. Remove `TURN_FORCE_RELAY` and redeploy.
4. Run `pnpm --filter @workspace/scripts run check:lesson` against the
   deployment as usual.
