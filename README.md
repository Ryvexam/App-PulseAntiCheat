<div align="center">

# 🛡️ Pulse Hesias

**Anti-cheat exam monitoring for the Hesias LMS.**
A Chrome (MV3) extension that locks the exam environment, paired with a self-hosted audit backend that stores tamper-evident proof and scores behaviour for proctors.

[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/postgres-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Storage](https://img.shields.io/badge/storage-S3%20%2F%20Garage-FF9900?logo=amazons3&logoColor=white)](https://garagehq.deuxfleurs.fr)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Security model](#security-model)
- [API reference](#api-reference)
- [The Chrome extension](#the-chrome-extension)
- [Testing](#testing)
- [Production deployment](#production-deployment)
- [Project layout](#project-layout)

---

## What it does

The **extension** runs on `*.hesias.fr` / `*.hesias.net` exam pages and enforces a controlled environment:

- 🖥️ **Fullscreen lock** — detects and re-arms fullscreen, flags fake-fullscreen and DevTools.
- 🧩 **Third-party extension gate** — blocks the exam until other extensions are disabled.
- 🪟 **Focus / tab / multi-screen guards** — alt-tab, tab switching and extra displays are logged.
- 🧪 **VM detection** — WebGL renderer, CPU/RAM, canvas benchmark → a 0–100 risk score.
- 🔒 **DOM integrity** — periodic SHA-256 (WebAssembly) of the question DOM detects tampering.
- 📸 **Evidence capture** — periodic + event-windowed screenshots queued in IndexedDB and uploaded with retry.
- 🚫 **Network filtering** — `declarativeNetRequest` rules block AI sites; blocked requests become infractions.

The **backend** ingests those signals, stores them durably, and gives proctors a dashboard:

- Receives infractions, heartbeats, environment reports and screenshots (HTTP + WebSocket).
- Stores metadata in **PostgreSQL** and screenshot evidence in **Garage** (S3-compatible) with SHA-256.
- Computes a deterministic **behavioural risk score** and findings per session.
- Optional **Mistral AI** second opinion on a session dossier.
- Self-hosts the signed extension (`/updates.xml` + `.crx`) for managed auto-update.

---

## Architecture

```
┌────────────────────┐        HTTPS / WSS         ┌──────────────────────────┐
│  Chrome extension  │  infractions · heartbeats  │   Express audit backend  │
│  (MV3, content +   │ ─────────────────────────▶ │   server.js              │
│  service worker)   │  environment · screenshots │                          │
└────────────────────┘                            │  ┌────────────────────┐  │
          ▲                                        │  │ scoring / analysis │  │
          │  /updates.xml + .crx (auto-update)     │  └────────────────────┘  │
          └────────────────────────────────────────┤                          │
                                                    └───────┬──────────┬───────┘
                                                            │          │
                                          metadata │        │          │ screenshot bytes
                                                    ▼        │          ▼
                                          ┌──────────────┐   │   ┌──────────────┐
                                          │  PostgreSQL  │   │   │   Garage S3  │
                                          │  sessions,   │   │   │  evidence/   │
                                          │  events, …   │   │   │  (sha256)    │
                                          └──────────────┘   │   └──────────────┘
                                                             ▼
                                                    ┌──────────────────┐
                                                    │ Proctor dashboard│
                                                    │  public/  + AI   │
                                                    └──────────────────┘
```

Everything runs as four containers via Docker Compose: `app`, `postgres`, `garage`, and a one-shot `garage-init` that provisions the bucket and access key.

---

## Quick start

**Prerequisites:** Docker + Docker Compose, and `openssl` (for `setup.sh`). Node ≥ 22 only if you want to run tests or build the extension on the host.

```bash
# 1. Generate strong secrets → .env + garage.toml
./setup.sh            # interactive (Enter accepts a generated default)
#   …or fully non-interactive:
./setup.sh -y

# 2. Start postgres + garage + app (migrations run automatically)
docker compose up -d --build

# 3. Verify
curl http://localhost:3000/health
#   → {"ok":true,"version":"1.0.0","storage":"postgres+s3","uptime":...}
```

Then open the proctor dashboard at **http://localhost:3000** and paste your `PULSE_DASHBOARD_TOKEN` (printed/stored in `.env`).

> The S3 API is exposed on `http://localhost:3900`. Postgres is **not** published to the host (internal network only).

---

## Configuration

`setup.sh` writes `.env` (consumed by the app) and renders `garage.toml` from `garage.toml.example` with matching cluster secrets. All settings:

| Variable | Description | Default |
|---|---|---|
| `PORT` | App listen port | `3000` |
| `NODE_ENV` | `production` enables fail-closed checks + HSTS | `production` |
| `PULSE_API_TOKEN` | Bearer token the extension sends. **Required in prod.** | — |
| `PULSE_DASHBOARD_TOKEN` | Token for the proctor dashboard (falls back to API token) | — |
| `CORS_ORIGINS` | Comma-separated allow-list, supports `*` wildcards | `https://pulse.hesias.fr,…` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://pulse:pulse@postgres:5432/pulse` |
| `PG_POOL_SIZE` | Max PG pool connections | `10` |
| `S3_ENDPOINT` | S3 endpoint (Garage by default) | `http://garage:3900` |
| `S3_REGION` / `S3_BUCKET` | S3 region / bucket | `garage` / `pulse-evidence` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials | generated |
| `S3_FORCE_PATH_STYLE` | Path-style addressing (required for Garage) | `true` |
| `S3_PUBLIC_BASE_URL` | Public CDN base for evidence (blank → proxied via API) | — |
| `GARAGE_KEY_NAME` | Garage key alias | `pulse-app` |
| `GARAGE_RPC_SECRET` | Garage inter-node RPC secret | generated |
| `GARAGE_ADMIN_TOKEN` / `GARAGE_METRICS_TOKEN` | Garage admin/metrics tokens | generated |
| `MISTRAL_API_KEY` | Optional — enables AI session analysis | — |
| `MISTRAL_MODEL` | Mistral model id | `mistral-small-latest` |

> **S3-compatible, not locked to Garage.** Point `S3_*` at AWS S3, Cloudflare R2, Scaleway, etc. and drop the `garage` services to use a managed bucket.

---

## Security model

This backend handles exam evidence — it is **fail-closed by design**:

- 🔐 **No insecure boot in production.** With `NODE_ENV=production`, the server **refuses to start** if any token or S3 credential is empty or a known placeholder (see `src/security.js`). Run `./setup.sh` to generate real secrets.
- 🧱 **Auth on every endpoint.** Ingestion uses `Authorization: Bearer $PULSE_API_TOKEN`; the dashboard uses `$PULSE_DASHBOARD_TOKEN` (header or `?token=`); the WebSocket requires the API token.
- 🪖 **Hardened headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and HSTS in production.
- 🙈 **No leakage** — 5xx errors return a generic message in production; internals are logged server-side only.
- 🤝 **Behind TLS** — `trust proxy` is on; terminate HTTPS at a reverse proxy (Caddy/Nginx/Traefik).

🚨 **Never commit secrets.** `.env`, `garage.toml`, and `extension.pem` are git-ignored. If a secret is ever exposed, **rotate it** — cleanup alone is not enough.

---

## API reference

### Ingestion — `Authorization: Bearer $PULSE_API_TOKEN`

| Method | Route | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/exam/screenshots` | multipart (`screenshot`, `studentId`, `examId`, …) | Upload capture → Garage + metadata |
| `POST` | `/api/exam/infractions` | JSON (`studentId`, `examId`, `type`, …) | Record an infraction + refresh risk score |
| `POST` | `/api/exam/environment` | JSON (`score`, `niveau`, `signaux`, …) | VM / environment report |
| `POST` | `/api/exam/heartbeat` | JSON (`extensionActive`, `fullscreen`, …) | Liveness + session state |
| `WS` | `/ws/audit?token=…` | `{kind, payload}` | Low-latency infraction/heartbeat transport (HTTP fallback) |

### Dashboard — `$PULSE_DASHBOARD_TOKEN` (header or `?token=`)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/audit/overview` | Proctor summary + totals |
| `GET` | `/api/exam/sessions` | Enriched session list |
| `GET` | `/api/exam/sessions/:studentId/:examId` | Timeline, infractions, evidence |
| `GET` | `/api/evidence/:key` | Stream a stored capture from Garage |
| `POST` | `/api/ai/analyze/:studentId/:examId` | Mistral AI dossier analysis (if configured) |
| `GET` | `/health` | Liveness + DB check |

---

## The Chrome extension

Source lives in [`extension-pulse/`](./extension-pulse). The build pipeline bundles, signs and packages it:

```bash
npm install                 # host-side, for build tooling
npm run build:wasm          # compile assembly/index.ts → core.wasm (SHA-256)
npm run build:ext           # bundle sources → dist/extension/
npm run release:ext         # build + sign → releases/pulse-vX.Y.Z.crx + updates.xml
```

- **Load unpacked (dev):** `chrome://extensions` → Developer mode → *Load unpacked* → `dist/extension/`.
- **Auto-update (managed):** the manifest's `update_url` points at `<backend>/updates.xml`; the backend serves the signed `.crx` from `releases/` (mounted read-only into the `app` container).
- The signing key `extension.pem` is **git-ignored** and auto-generated by `scripts/pack-crx.js` if missing. Keep it safe — it defines the extension ID.

---

## Testing

```bash
npm test                 # unit: scoring, behavioural analysis, security guards (no services needed)
npm run test:integration # end-to-end against a running stack (Postgres + Garage round-trip)
```

The integration suite loads `.env` itself and asserts the full happy path: health, auth enforcement, infraction/heartbeat/environment ingestion, and a screenshot **upload → Garage → evidence-proxy retrieval** byte-for-byte round-trip. Run it after `docker compose up -d`.

---

## Production deployment

1. Run `./setup.sh` and keep `.env` + `garage.toml` private (mode `600`).
2. `docker compose up -d --build` (the `app` container runs migrations on boot, then starts).
3. Terminate **HTTPS** at a reverse proxy in front of the app.
4. Persist the named volumes: `postgres-data`, `garage-data`.
5. Define an evidence **retention policy** consistent with your institution's data rules.
6. For higher scale, swap Garage for a managed S3 bucket via `S3_*`, or move Postgres to a managed instance.

Containers declare `restart: unless-stopped` and health checks; `app` shuts down gracefully on `SIGTERM` (drains the HTTP server, closes the WS server and PG pool).

---

## Project layout

```
server.js                Express app: routes, WS, graceful shutdown
src/
  config.js              Env → typed config
  db.js                  PG pool + query/transaction helpers
  storage.js             S3/Garage upload + streaming
  scoring.js             Infraction taxonomy + severities
  analysis.js            Deterministic behavioural findings
  security.js            Fail-closed secret checks + security headers
  migrate.js             SQL migration runner
migrations/              Versioned schema (*.sql)
public/                  Proctor dashboard (static)
extension-pulse/         Chrome MV3 extension source
assembly/                AssemblyScript SHA-256 → core.wasm
scripts/                 build-extension, pack-crx, init-garage
test/                    Unit + integration tests
setup.sh                 Interactive secret generation → .env + garage.toml
docker-compose.yml       app · postgres · garage · garage-init
```

---

<div align="center">
<sub>Built for the Hesias exam platform · MIT licensed · Handle exam evidence responsibly.</sub>
</div>
