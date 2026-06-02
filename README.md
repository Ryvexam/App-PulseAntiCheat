<div align="center">

# 🛡️ Pulse Hesias — Backend

**Audit backend for the Hesias LMS anti-cheat system.**
Receives telemetry from the Chrome extension, stores tamper-evident evidence, scores behaviour, and exposes a proctor dashboard.

[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/postgres-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Storage](https://img.shields.io/badge/storage-S3%20%2F%20Garage-FF9900?logo=amazons3&logoColor=white)](https://garagehq.deuxfleurs.fr)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

## What it does

- Receives **infractions, heartbeats, environment reports and screenshots** from the extension (HTTP + WebSocket).
- Stores metadata in **PostgreSQL** and screenshot evidence in **Garage** (S3-compatible) with SHA-256 integrity.
- Computes a deterministic **behavioural risk score** and findings per session.
- Optional **Mistral AI** second opinion on a session dossier.
- Self-hosts the signed extension (`.crx` + `/updates.xml`) for managed auto-update.

---

## Architecture

```
┌────────────────────┐        HTTPS / WSS         ┌──────────────────────────┐
│  Chrome extension  │  infractions · heartbeats  │   Express audit backend  │
│  (MV3)             │ ─────────────────────────▶ │   server.js              │
└────────────────────┘  environment · screenshots │                          │
          ▲                                        │  ┌────────────────────┐  │
          │  /updates.xml + .crx (auto-update)     │  │ scoring / analysis │  │
          └────────────────────────────────────────┤  └────────────────────┘  │
                                                    └───────┬──────────┬───────┘
                                                            │          │
                                          metadata │        │          │ screenshot bytes
                                                    ▼        │          ▼
                                          ┌──────────────┐       ┌──────────────┐
                                          │  PostgreSQL  │       │   Garage S3  │
                                          │  sessions,   │       │  evidence/   │
                                          │  events, …   │       │  (sha256)    │
                                          └──────────────┘       └──────────────┘
```

Four containers via Docker Compose: `app`, `postgres`, `garage`, `garage-init` (one-shot bucket provisioning).

---

## Quick start

**Prerequisites:** Docker + Docker Compose, `openssl`. Node ≥ 22 only needed for running tests on the host.

```bash
# 1. Generate secrets → .env + garage.toml
./setup.sh            # interactive
./setup.sh -y         # non-interactive (accept generated defaults)

# 2. Start the stack (migrations run automatically)
docker compose up -d --build

# 3. Verify
curl http://localhost:3000/health
# → {"ok":true,"version":"1.0.0","storage":"postgres+s3","uptime":...}
```

Open the proctor dashboard at **http://localhost:3000** and paste your `PULSE_DASHBOARD_TOKEN` (stored in `.env`).

---

## Configuration

`setup.sh` writes `.env` and renders `garage.toml` from `garage.toml.example`.

| Variable | Description | Default |
|---|---|---|
| `PORT` | App listen port | `3000` |
| `NODE_ENV` | `production` enables fail-closed checks + HSTS | `production` |
| `PULSE_API_TOKEN` | Bearer token the extension sends. **Required in prod.** | — |
| `PULSE_DASHBOARD_TOKEN` | Token for proctor dashboard (falls back to API token) | — |
| `CORS_ORIGINS` | Comma-separated allow-list, supports `*` wildcards | `https://pulse.hesias.fr,…` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://pulse:pulse@postgres:5432/pulse` |
| `PG_POOL_SIZE` | Max PG pool connections | `10` |
| `S3_ENDPOINT` | S3 endpoint | `http://garage:3900` |
| `S3_REGION` / `S3_BUCKET` | S3 region / bucket | `garage` / `pulse-evidence` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials | generated |
| `S3_FORCE_PATH_STYLE` | Required for Garage | `true` |
| `S3_PUBLIC_BASE_URL` | Public CDN base for evidence (blank → proxied via API) | — |
| `GARAGE_KEY_NAME` | Garage key alias | `pulse-app` |
| `GARAGE_RPC_SECRET` | Garage inter-node RPC secret | generated |
| `GARAGE_ADMIN_TOKEN` / `GARAGE_METRICS_TOKEN` | Garage admin/metrics tokens | generated |
| `MISTRAL_API_KEY` | Optional — enables AI session analysis | — |
| `MISTRAL_MODEL` | Mistral model id | `mistral-small-latest` |

> **S3-compatible, not locked to Garage.** Point `S3_*` at AWS S3, Cloudflare R2, Scaleway, etc.

---

## Security model

- **Fail-closed in production.** Server refuses to start if any token or S3 credential is empty or a known placeholder (`src/security.js`).
- **Auth on every endpoint.** Ingestion uses `Authorization: Bearer $PULSE_API_TOKEN`; dashboard uses `$PULSE_DASHBOARD_TOKEN`.
- **Hardened headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, HSTS in production.
- **No leakage** — 5xx errors return a generic message in production.
- **Behind TLS** — `trust proxy` on; terminate HTTPS at a reverse proxy (Caddy/Nginx/Traefik).

🚨 **Never commit secrets.** `.env` and `garage.toml` are git-ignored. If a secret is ever exposed, rotate it.

---

## API reference

### Ingestion — `Authorization: Bearer $PULSE_API_TOKEN`

| Method | Route | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/exam/screenshots` | multipart (`screenshot`, `studentId`, `examId`, …) | Upload capture → S3 + metadata |
| `POST` | `/api/exam/infractions` | JSON (`studentId`, `examId`, `type`, …) | Record infraction + refresh risk score |
| `POST` | `/api/exam/environment` | JSON (`score`, `niveau`, `signaux`, …) | VM / environment report |
| `POST` | `/api/exam/heartbeat` | JSON (`extensionActive`, `fullscreen`, …) | Liveness + session state |
| `WS` | `/ws/audit?token=…` | `{kind, payload}` | Low-latency transport (HTTP fallback) |

### Dashboard — `$PULSE_DASHBOARD_TOKEN` (header or `?token=`)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/audit/overview` | Proctor summary + totals |
| `GET` | `/api/exam/sessions` | Enriched session list |
| `GET` | `/api/exam/sessions/:studentId/:examId` | Timeline, infractions, evidence |
| `GET` | `/api/evidence/:key` | Stream a stored capture from S3 |
| `POST` | `/api/ai/analyze/:studentId/:examId` | Mistral AI dossier analysis |
| `GET` | `/health` | Liveness + DB check |

---

## Testing

```bash
npm test                 # unit: scoring, analysis, security guards (no services needed)
npm run test:integration # end-to-end against a running stack (Postgres + S3 round-trip)
```

---

## Production deployment

1. Run `./setup.sh` — keep `.env` and `garage.toml` private (mode `600`).
2. `docker compose up -d --build` — migrations run on boot.
3. Terminate **HTTPS** at a reverse proxy.
4. Persist volumes: `postgres-data`, `garage-data`.
5. Define an evidence **retention policy** per your institution's data rules.

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
scripts/                 init-garage, build/pack/verify extension helpers
test/                    Unit + integration tests
setup.sh                 Interactive secret generation → .env + garage.toml
docker-compose.yml       app · postgres · garage · garage-init
```

---

<div align="center">
<sub>Part of the Pulse Hesias anti-cheat system · MIT licensed · Handle exam evidence responsibly.</sub>
</div>
