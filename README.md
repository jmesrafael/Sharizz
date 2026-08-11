# Sharizz

Temporary, original-quality photo and video transfer rooms. The landing page is a riddle gate — only whoever knows the trick (type the current clock time) can create a room. Once created, the owner shares a link that carries its own access token, so recipients just open it and go — no code, no PIN. Rooms and all files are permanently deleted 24 hours after creation.

Sharizz is intentionally **not** a cloud storage product — no accounts, no permanence, no compression, no transcoding. It's AirDrop, through a temporary web room.

## Architecture

Sharizz runs standalone on **Cloudflare Pages** — one deployment serves the built React app and the `/api/*` backend (a Hono app, running as a Pages Function) from the same origin. A separate, minimal Worker exists solely to run the hourly cleanup cron, since Pages Functions can't schedule themselves.

```
                         ┌─── Cloudflare Pages ("sharizz") ──────────────────┐
React (Vite/TS) ◀──HTTPS─┤ static assets (frontend/dist)                    │
                         │ /api/* ──▶ Pages Function (Hono, frontend/functions) │
                         └──────────────────┬─────────────────────────────────┘
                                             ├──▶ D1 (sharizz-db)   [room + file metadata]
                                             └──▶ R2 (sharizz-media) [original files]

Cloudflare Worker ("sharizz-worker", cron-only) ──Cron Trigger (hourly)──▶ same D1 + R2
  — sweeps any expired room nobody revisited; rooms that ARE touched past
    expiry are reaped immediately by the Pages Function itself.
```

- **Uploads** stream directly from the browser into R2 (`bucket.put(key, request.body, …)`) via the Pages Function — never buffered in memory, so multi-hundred-MB videos are fine.
- **Downloads** stream straight from R2, with Range support so `<video>` previews can seek without downloading the whole file first.
- **The gate** accepts a 4-digit code only if it matches the current time (12-hour, zero-padded, ±2 minutes) in `Asia/Manila`. It's hashed with PBKDF2-SHA256 via Web Crypto before being stored, purely to satisfy the schema — it's not checked again after room creation.
- **Sessions** are stateless HMAC-signed tokens (`SESSION_SECRET`), scoped to a room and its expiry. Stored in `sessionStorage` on the client. Guest links carry the token in the URL (`?token=...`) so a recipient never has to solve the gate themselves; the app picks it up once and scrubs it from the visible URL.
- **Live updates** use Server-Sent Events: the Pages Function polls D1 every 3s inside an open stream and pushes a fresh file list only when it changes. No Durable Objects, no WebSocket infrastructure.
- **Download All** streams a ZIP (store-only, no recompression) built on the fly from R2 objects via `client-zip`, capped by `DOWNLOAD_ALL_ZIP_MAX_BYTES` — past that, users download files individually.
- **Expired-room cleanup** happens two ways: lazily, the instant anyone (owner or guest) hits an endpoint for a room past its `expires_at` — that request triggers deletion of its D1 rows and R2 objects (originals + thumbnails) before returning `ROOM_EXPIRED`; and as an hourly backstop via the cron Worker, for rooms nobody ever revisits. Both paths share `worker/src/lib/roomCleanup.ts`.

## Project layout

```
shared/                     Types + limits shared between frontend and worker
frontend/                   React + Vite + TypeScript + React Router — the Pages project
frontend/functions/api/     Pages Function catch-all; re-exports the Hono app below
worker/                     Hono app (routes/lib, shared by Pages + the cron Worker), D1 migrations, tests
worker/wrangler.toml        Deploys worker/ as a CRON-ONLY Worker (no HTTP traffic routed to it)
```

## Original-file guarantee

Sharizz never compresses, resizes, re-encodes, or converts uploaded files — not on upload, not on download, not for previews. The Worker's R2 `put`/`get` calls pass the request/response body straight through. Thumbnails are just the original image rendered smaller by the `<img>` tag's CSS, not a server-generated derivative.

## Local development

```bash
npm install

# Terminal 1 — Worker API on http://localhost:8787
npm run dev:worker

# Terminal 2 — Frontend on http://localhost:5173
npm run dev:frontend
```

Copy `.env.example` to `.env` in `frontend/` (for `VITE_API_BASE_URL`) and create `worker/.dev.vars` with a `SESSION_SECRET` for local development:

```
SESSION_SECRET=any-long-random-string-for-local-dev
```

Apply migrations to the local D1 instance before first run:

```bash
npm run migrate:local
```

## Tests

```bash
npm run test:worker
```

Covers: PIN hashing/verification, session token signing/expiry, room creation via the time-gate, wrong-code rejection, gate attempt lockout, expired-room rejection, authorized/unauthorized room access (header and query-token), file upload authorization, file metadata persistence, unsupported file type rejection, authorized/unauthorized downloads, and cron cleanup (including idempotency and missing-R2-object handling).

## Deployment — READ BEFORE RUNNING

**Do not deploy until the correct Cloudflare account is confirmed.** Both `worker/wrangler.toml` and `frontend/wrangler.toml` point at one specific account/`account_id` and one specific D1 `database_id` — confirm `wrangler whoami` matches that account before running any deploy command below, otherwise you'll either get an auth error or (worse) deploy against the wrong account's resources.

1. Authenticate Wrangler against the **intended** Sharizz Cloudflare account (not whatever account is already logged in on this machine):
   ```bash
   npx wrangler login
   npx wrangler whoami   # confirm this is the right account before continuing
   ```
2. Confirm the existing resources are present in that account (do not create duplicates):
   ```bash
   npx wrangler r2 bucket list        # expect to see sharizz-media
   npx wrangler d1 list                # expect to see sharizz-db
   npx wrangler pages project list     # expect to see the "sharizz" Pages project
   ```
   If `account_id` or `database_id` in either `wrangler.toml` don't match what you see here, update both files (they must stay in sync — same D1 database, same R2 bucket, same account).
3. Set the session secret for **both** deployments (never commit it):
   ```bash
   npx wrangler secret put SESSION_SECRET --config worker/wrangler.toml
   npx wrangler pages secret put SESSION_SECRET --project-name sharizz
   ```
4. Apply migrations to the **remote** database:
   ```bash
   npm run migrate:remote
   ```
5. Deploy the Pages project — this is the one users hit; it builds the frontend and deploys `frontend/functions/api/[[path]].ts` as the API alongside it, all from one origin:
   ```bash
   npm run deploy:pages
   ```
   No `VITE_API_BASE_URL` is needed for production builds: the frontend calls `/api/...` relative to its own origin, and Pages serves both from that same origin. `VITE_API_BASE_URL` is only used in local dev (see above), where the Vite dev server and `wrangler dev` run on different ports.
6. Deploy the cron-only Worker — it never receives user traffic, it only runs the hourly expired-room sweep:
   ```bash
   npm run deploy:cron
   ```
7. If `sharizz.pages.dev` (or whatever domain you use) was ever left pointed at a build of the frontend from **before** `frontend/functions/api/` existed, redeploy step 5 — the old build has no working `/api/*` backend attached (Pages returns `405` for any method it has no Function for), which is the "fallback to localhost" / `405` symptom this restructure fixes. After step 5, the same `sharizz.pages.dev` URL serves the full app standalone — no separate Worker or custom domain juggling required.

## Configurable limits

Set as Worker vars in `wrangler.toml` (`[vars]`), not hardcoded through the codebase:

| Variable | Default | Meaning |
|---|---|---|
| `MAX_FILE_SIZE` | 5 GB | Per-file upload limit |
| `MAX_FILES_PER_ROOM` | 500 | File count limit per room |
| `MAX_ROOM_STORAGE` | 20 GB | Total storage per room |
| `MAX_GATE_ATTEMPTS` | 8 | Failed gate codes before lockout (per client IP) |
| `DOWNLOAD_ALL_ZIP_MAX_BYTES` | 2 GB | Above this, "Download All" is disabled in favor of individual downloads |

## Security notes

- Room IDs are 128-bit random and URL-safe.
- **The time-gate is obscurity, not authentication.** It has no account behind it — anyone who reads the bundle or watches network traffic can work out the rule. It's rate-limited per IP (`MAX_GATE_ATTEMPTS`) so it can't be brute-forced by script, but it should not be relied on to protect anything sensitive.
- Once a room exists, real access control takes over: guest links carry a signed, room-scoped, time-limited session token — not the gate code — and every sensitive endpoint (room state, upload, download, events) re-validates room expiry and session authorization server-side.
- Filenames are sanitized for display; storage keys always use generated IDs (`rooms/{roomId}/{fileId}{ext}`), never the original filename, eliminating path traversal risk.
- The R2 bucket is never exposed directly — all access goes through the Worker's authorization checks.
- No Cloudflare credentials, tokens, or secrets exist in frontend code, `wrangler.toml`, or anywhere committed to git.
