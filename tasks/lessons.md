# Lessons

Self-corrections captured during the production-readiness pass, so the same
mistakes don't recur.

## Testing with the Fetch API

- **Reading a `Response` body twice throws `Body is unusable: Body has already
  been read`.** The trap: `assert.equal(res.ok, true, await res.text())` *always*
  evaluates `await res.text()` (it's a function argument), consuming the body —
  so a following `res.json()` fails even on success. Read the body **once**:
  `const text = await res.text(); assert.equal(res.ok, true, text); JSON.parse(text)`.

## Object-storage provisioning must be idempotent

- A first-deploy `CreateBucket` can race or duplicate work already done by an init
  job. Swallow `BucketAlreadyExists` / `BucketAlreadyOwnedByYou` instead of letting
  the 409 crash startup. Provisioning should converge, not assert virgin state.

## Stale named volumes hide credential drift

- Garage (and any S3 backend) granted permissions to the **old** key id persist in
  the data volume. Regenerating `S3_*` secrets then `docker compose up` leaves the
  app's new key unauthorized (`AccessDenied` on `PutObject`). For a clean first
  deploy after changing secrets, recreate volumes (`docker compose down -v`).

## Fail closed, not open

- Auth middleware that calls `next()` when the token is empty turns a missing
  secret into "no auth at all." In production, **refuse to start** rather than run
  unauthenticated. Surprising-but-safe beats convenient-but-silent.

## Don't commit generated or secret files

- `.env`, `garage.toml` (rendered from a template), `extension.pem`, build output
  (`dist/`, `*.crx`), and `.DS_Store` should be git-ignored. Track templates
  (`*.example`) and source, not artifacts or secrets.
