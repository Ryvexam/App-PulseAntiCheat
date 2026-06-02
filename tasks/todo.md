# Production-readiness pass — Pulse Hesias

Goal: make the anti-cheat exam stack production ready, clean, tested, documented,
with a `setup.sh` and a verified localhost deployment.

## Plan & status

- [x] **Security — scrub committed secrets**
  - [x] Remove live `MISTRAL_API_KEY` from `.env`
  - [x] Delete `extension.pem` (leaked RSA private signing key) from the tree
  - [x] Gitignore `*.pem`, `.env*`, `garage.toml`
- [x] **Clean junk** — `convclaude.txt`, empty `web-extension.crx`, all `.DS_Store`,
      build output `dist/`, legacy `data/`, `tmp/*`
- [x] **Ignore files** — robust `.gitignore` + new `.dockerignore`
- [x] **Harden `server.js`** (new `src/security.js`)
  - [x] Fail-closed: refuse to boot in production with empty/placeholder secrets
  - [x] Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy, HSTS)
  - [x] Hide 5xx internals in production; structured access log
  - [x] Graceful shutdown (SIGTERM/SIGINT → drain HTTP + WS + PG pool)
  - [x] `/health` version from `package.json`; `trust proxy`; disable `x-powered-by`
- [x] **`setup.sh`** — interactive env prompts, strong secret generation,
      writes `.env` + renders `garage.toml` from `garage.toml.example`, `-y`/`-f` flags
- [x] **Tests** — unit (`scoring`, `analysis`, `security`) + integration (live stack)
- [x] **`package.json`** — `engines`, `test`/`test:integration`, license; add `LICENSE`
- [x] **README** — full rewrite (architecture, quickstart, security model, API, testing)
- [x] **Deploy on localhost** — `docker compose up`, verify health/endpoints/garage
- [x] **Fix real bug** — idempotent `ensureBucket` (was crash-looping on `BucketAlreadyExists`)

## Review

### What changed
- **Security**: the single most important fix is fail-closed startup. Previously an
  empty `PULSE_API_TOKEN` (the committed default) silently disabled auth on every
  ingestion endpoint. Now production refuses to start without real secrets.
- **Bug fixed**: `src/storage.js#ensureBucket` swallowed the `HeadBucket` failure and
  then let `CreateBucket`'s `BucketAlreadyExists` (409) crash the app on boot. Made
  bucket provisioning idempotent.
- **Repo hygiene**: removed a leaked Mistral key and the extension's private signing
  key from the tree, plus ~600 KB of dev cruft and regenerable build output.
- **Ops**: `restart: unless-stopped` + health checks on all services, graceful
  shutdown, `releases/` mounted read-only so the host-built CRX is served without
  baking it into the image.

### Verification
- `npm test` → 16/16 unit tests pass.
- `npm run test:integration` → 9/9 pass against the live stack, including a
  screenshot **upload → Garage → evidence-proxy** byte-for-byte round-trip.
- Manual: `/health` ok, security headers present, dashboard served, `/updates.xml`
  + `.crx` served (476 KB), unauthenticated ingestion → 401.
- `npm run build:ext` → WASM compiled + bundles built + manifest patched.
- All JS sources and bundles pass `node --check`.

### Follow-ups for the operator (not code)
- **Rotate the exposed `MISTRAL_API_KEY`** — it was committed and must be revoked.
- Generate a fresh `extension.pem` (auto-created by `scripts/pack-crx.js`) and keep
  it secret; it defines the extension ID.
- Terminate HTTPS at a reverse proxy; define an evidence retention policy.
