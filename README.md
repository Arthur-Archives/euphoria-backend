# ED-API

Backend API for license verification, game server querying, translations, products, contributors, donators, and stats.

## Runtime

This branch runs on Fastify and compiles TypeScript 6 source files into `dist/`.

## Scripts

- `pnpm run dev` - Start TypeScript Fastify source in watch mode
- `pnpm run build` - Compile TypeScript and copy runtime assets into `dist/`
- `pnpm run start` - Start the compiled Fastify server
- `pnpm run types` - Verify TypeScript without emitting files
- `pnpm run update:games` - Update game definitions
- `pnpm run fetch:gameicons` - Fetch game icons
- `pnpm run sync:translations` - Sync translation files now
- `pnpm run sync:blueprint` - Sync blueprint extensions now

## Setup

1. Install dependencies:

```sh
pnpm install
```

1. Configure `.env` with required credentials, including `REDIS_URL` for API
   stats storage, and optional sync settings.

2. Start development server:

```sh
pnpm run dev
```

1. Start production runtime:

```sh
pnpm run build
pnpm run start
```

## Reverse Proxy Setup (Cloudflare + Nginx)

For a Cloudflare -> Nginx -> API chain, set these values in `.env`:

```env
PROXY_MODE=cloudflare
TRUST_PROXY=true
TRUST_PROXY_HOPS=1
HOST=0.0.0.0
PORT=3000
```

Use this Nginx location block so client IP forwarding works correctly:

```nginx
location / {
 proxy_pass http://127.0.0.1:3000;

 proxy_http_version 1.1;
 proxy_set_header Host $host;

 # Proxy chain headers
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 proxy_set_header X-Forwarded-Proto $scheme;
 proxy_set_header X-Forwarded-Host $host;
 proxy_set_header X-Real-IP $remote_addr;

 # Cloudflare origin client IP headers
 proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
 proxy_set_header True-Client-IP $http_true_client_ip;
}
```

Notes:

- Keep Cloudflare proxy enabled for the public DNS record.
- Restrict origin traffic so only Cloudflare can reach Nginx.
- Keep `TRUST_PROXY_HOPS=1` when Nginx is the direct upstream for the API.

## Blueprint Sync

`public/blueprint.json` is synced at startup and every 24 hours.

Optional `.env` settings:

```env
BLUEPRINT_EXTENSIONS_URL=https://blueprint.zip/api/extensions
BLUEPRINT_EXTENSIONS_FALLBACK_URL=https://api.blueprintframe.work/api/extensions
BLUEPRINT_SYNC_COOKIE=
BLUEPRINT_SYNC_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
BLUEPRINT_SYNC_ORIGIN=https://blueprintframe.work
BLUEPRINT_SYNC_REFERER=https://blueprintframe.work/
BLUEPRINT_SYNC_INTERVAL_MS=86400000
BLUEPRINT_SYNC_TIMEOUT_MS=20000
```

## Translation Sync

Translations under `public/translations` are synced at startup and every 24 hours.

Optional `.env` settings:

```env
TRANSLATIONS_REPO_OWNER=EuphoriaTheme
TRANSLATIONS_REPO_NAME=blueprint-translations
TRANSLATIONS_REPO_REF=main
TRANSLATIONS_SYNC_INTERVAL_MS=86400000
TRANSLATIONS_SYNC_TIMEOUT_MS=20000
TRANSLATIONS_SYNC_GITHUB_TOKEN=
```

Set `TRANSLATIONS_AUTO_FETCH=false` to keep bundled translations unchanged.

For a self-hosted raw source, set `TRANSLATIONS_SOURCE_BASE_URL`. The sync then
tries `TRANSLATIONS_REMOTE_PATHS` (default: `translations,public/translations`)
for each bundled file. `TRANSLATIONS_FILE_LIST` can limit the files synced, and
`TRANSLATIONS_GITHUB_TREE_LOOKUP=true` enables a GitHub-tree fallback for raw
GitHub URLs.

`POST /translations/translate/bulk` accepts JSON and form-encoded request bodies.

## Main Endpoints

- `GET /`
- `GET /health`
- `GET /openapi.json`
- `GET /docs`
- `GET /public/*`
- `GET /stats`
- `POST /telemetry/panel`
- `GET /products`
- `GET /donators`
- `GET /contributors`
- `GET /team`
- `GET /translations`
- `POST /translations/translate/bulk`
- `GET /gameapi`
- `GET /gameapi/:game/ip=:ip&port=:port`
- `POST /license/verify-license`
- `POST /license/v2/verify-license`
- `GET /versions`
- `GET /rcon/health`
- `POST /rcon/variables`
- `POST /rcon/players`

### Aquadactyl panel telemetry

The optional panel telemetry endpoint accepts one aggregate report per
installation and retains the latest report for 90 days. It is intentionally
publicly ingestible so ordinary panel installations do not need a secret token.
The endpoint validates the payload schema, limits payload size, rate-limits
requests, and stores one snapshot per anonymous installation UUID.

The panel sends only an installation UUID, software/driver versions, Docker
availability, and aggregate resource counts. It must not send user identity,
network addresses, domains, server names, credentials, or request contents.

## API Docs (Scalar)

This API now exposes generated OpenAPI docs for public consumers:

- OpenAPI JSON: `GET /openapi.json`
- Scalar UI: `GET /docs`

Optional `.env` settings:

```env
API_DOCS_ENABLED=true
API_DOCS_PATH=/docs
OPENAPI_JSON_PATH=/openapi.json
API_TITLE=ED API
API_DESCRIPTION=Public API for licensing, game server querying, translations, metadata, and RCON utilities.
API_VERSION=1.0.0
API_CONTACT_EMAIL=support@euphoriadevelopment.uk
```

## Rate Limiting (Recommended For Public APIs)

Global request throttling is enabled by default.

Optional `.env` settings:

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=120
RATE_LIMIT_TIME_WINDOW=1 minute
RATE_LIMIT_ALLOW_LIST=
```

`RATE_LIMIT_ALLOW_LIST` accepts a comma-separated list of client IPs to bypass limits.

## Game API Abuse Controls

`GET /gameapi/:game/ip=:ip&port=:port` now has additional protections:

- Route-specific rate limits (independent from global API limits)
- Host/IP validation with private/reserved target blocking by default
- Request deduplication and short-lived response caching
- Max in-flight query cap to prevent backend exhaustion
- Outbound query timeout/retry caps for FiveM and GameDig lookups

Optional `.env` settings:

```env
GAMEAPI_RATE_LIMIT_MAX=30
GAMEAPI_RATE_LIMIT_TIME_WINDOW=1 minute
GAMEAPI_MAX_CONCURRENT_REQUESTS=50
GAMEAPI_CACHE_TTL_MS=5000
GAMEAPI_CACHE_MAX_ENTRIES=500
GAMEAPI_GAMES_CACHE_TTL_MS=60000
GAMEAPI_BLOCK_PRIVATE_TARGETS=true
GAMEAPI_MAX_HOST_LENGTH=253
GAMEAPI_DNS_LOOKUP_TIMEOUT_MS=2500
GAMEAPI_BLOCKED_HOSTNAMES=localhost,localhost.localdomain,ip6-localhost,broadcasthost
GAMEAPI_SPECIAL_GAME_IDS=fivem,gta5f,beammp,minecraft

GAMEQUERY_SOCKET_TIMEOUT_MS=5000
GAMEQUERY_ATTEMPT_TIMEOUT_MS=7000
GAMEQUERY_MAX_RETRIES=0
FIVEM_HTTP_TIMEOUT_MS=5000
FIVEM_MAX_RESPONSE_BYTES=1048576
```

## License API Configuration

Optional `.env` overrides:

```env
LICENSE_API_V1_URL=https://license.euphoriadevelopment.uk/api/v1/validate
LICENSE_API_V2_URL=https://licensing.euphoriadevelopment.uk/api/licenses/validate
LICENSE_API_V2_TOKEN=optional-bearer-token-for-v2
```

`POST /license/v2/verify-license` body example:

```json
{
  "productId": "my-product-id",
  "licenseKey": "ABCD-EFGH-IJKL-MNOP",
  "hwid": "pc-main-rig-01",
  "ip": "203.0.113.10"
}
```
