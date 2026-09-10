# Deployment — AWS EC2 + Vercel

The application is split across two hosts.

| Piece | Where | Why |
| --- | --- | --- |
| `frontend` | Vercel | Static bundle. Vercel builds it and puts it on a CDN; nothing about it needs a server. |
| `backend`, `pose-service`, `postgres`, `caddy` | One EC2 instance | The pose service holds a loaded model in memory and the backend holds the database. Both are stateful in ways a serverless platform is not shaped for. |

The two halves talk over the public internet, so the browser holds an HTTPS
page from Vercel and calls an HTTPS API on EC2. That single fact drives most of
the configuration below: **the EC2 side must have a real certificate.** A page
served over HTTPS is not permitted to call `http://` or open `ws://`, and the
browser blocks it with no fallback.

---

## 1. What you need before starting

- An EC2 instance. **t3.medium (2 vCPU / 4 GB) is the floor.** The pose service
  loads torch plus the YOLOv8 weights and sits around 1.5–2 GB resident during a
  session; a t3.small would be killed by the OOM reaper mid-exercise.
- 20 GB of disk. The pose image is roughly 2.5 GB even with CPU-only torch.
- An Elastic IP, so the address survives a stop/start.
- A domain name you control, with an **A record already pointing at that
  Elastic IP**. Caddy requests the certificate on first start and will fail if
  DNS does not yet resolve.
- A Gmail account with 2-Step Verification on, and an **app password**
  (Google Account → Security → App passwords). The backend refuses to start in
  production without working SMTP, deliberately: an unsendable verification
  email locks every new account out of itself permanently.

### Security group

| Direction | Port | Source | Why |
| --- | --- | --- | --- |
| Inbound | 22 | your IP only | SSH |
| Inbound | 80 | 0.0.0.0/0 | ACME HTTP-01 challenge, and the redirect to 443 |
| Inbound | 443 | 0.0.0.0/0 | The API and the pose WebSocket |

Nothing else. In particular **not 5432** — `docker-compose.prod.yml` does not
publish the database to the host at all, and it should stay that way.

---

## 2. Prepare the instance

```bash
ssh ubuntu@<elastic-ip>

sudo apt-get update && sudo apt-get upgrade -y

# Docker Engine + the compose plugin, from Docker's own repository.
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker            # or log out and back in

docker --version && docker compose version
```

A t3.medium has no swap, and the pose service's first model load is the peak.
Two gigabytes of swap costs nothing and turns a hard OOM kill into a slow
first request:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. Deploy

```bash
git clone <your-repo-url> movera
cd movera

cp .env.production.example .env
nano .env          # fill in every value - see the notes inside the file
```

Generate the four secrets with `openssl rand -hex 48`, once each. They must be
four **different** values: `POSE_TICKET_SECRET` and `POSE_SERVICE_TOKEN` are
shared between the backend and the pose service and must match byte for byte
across those two, but no secret should serve two purposes.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes 10–20 minutes; almost all of it is torch. Watch it come
up:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

All four services should reach `healthy`. The pose service is last — it has a
90-second start period because loading the model on a burstable instance is
genuinely slow.

Migrations run automatically from the backend's entrypoint on every start.

### Populate the exercise library

The application has nothing to prescribe until this runs:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  node dist/tools/apply-exercise-library.js
```

It is idempotent and destructive of nothing: exercises are matched by slug and
updated in place, and a changed rule config is added as a new version with the
previous one retired, so historical reports keep the thresholds that actually
judged them. Run it again after any deploy that changes `seed-exercises.ts`.

> **Do not run `prisma/seed.ts` here.** It deletes every session, report and
> assignment to rebuild a fixed demo dataset, and creates accounts on a shared
> published password. It is deliberately not compiled into the production
> image — there is no `dist/tools/seed.js` and that is on purpose.

### Check it

```bash
curl -fsS https://<your-domain>/api/v1/health
```

---

## 4. Vercel

In the Vercel project:

- **Root Directory:** `apps/frontend`. Leave "Include files outside the root
  directory" enabled so the workspace lockfile at the repo root is reachable.
- **Framework preset:** Vite (auto-detected).

Environment variables — these are read by Vite at **build** time and compiled
into the bundle, so a change to either means a **redeploy**, not a restart:

```
VITE_API_URL                 https://<your-domain>/api/v1
VITE_POSE_WS_URL             wss://<your-domain>/ws/session
VITE_POSE_FRAME_SAMPLE_FPS   7
VITE_POSE_IMAGE_WIDTH        480
VITE_POSE_IMAGE_QUALITY      0.6
```

`apps/frontend/vercel.json` supplies the single-page-app rewrite. Without it a
reload on `/patient/progress` returns 404, because that path only exists inside
the bundle.

Once the Vercel domain is known, put it in `FRONTEND_URL` on the EC2 side and
restart — it is compared verbatim against the browser's `Origin` header for
both CORS and the pose WebSocket handshake:

```bash
nano .env      # FRONTEND_URL=https://your-app.vercel.app   (no trailing slash)
docker compose -f docker-compose.prod.yml up -d
```

---

## 5. How the request paths fit together

```
browser ──HTTPS──> Vercel CDN                     static bundle
   │
   ├──HTTPS──> caddy :443 ──> backend :3000       everything under /
   └──WSS────> caddy :443 ──> pose-service :8000  only /ws/session
```

Caddy routes **only** `/ws/session` to the pose service. Its other routes —
`/analyze`, `/docs`, `/benchmark` — stay on the compose network. `/analyze`
runs a full pose inference on any image posted to it with no authentication of
any kind, so leaving it publicly reachable would hand an anonymous caller the
instance's CPU. The service also declines to mount it when
`POSE_ENVIRONMENT=production`; both locks are deliberate, because either one
alone is a single configuration mistake away from being the only one.

Inside the network the two services authenticate each other with
`POSE_SERVICE_TOKEN` (pose → backend, for writing repetitions) and
`POSE_TICKET_SECRET` (the short-lived ticket the browser presents on the
WebSocket).

---

## 6. Operations

**Update to a new commit**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations apply on start. Old images accumulate; `docker image prune -f`
occasionally.

**Logs.** Every service is capped at 3 × 10 MB by the `logging` block, so they
cannot fill the disk.

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f pose-service
```

**Database backup.** The volume is the only copy of the clinical data:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backup-$(date +%F).sql.gz"
```

Put that on a cron and copy it to S3. Restoring:

```bash
gunzip -c backup-2026-09-10.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

**A shell on the database**

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

---

## 7. When something is wrong

**Sign-in works, then the session is gone on reload.** The refresh cookie is
cross-site — Vercel's domain is not the EC2 domain — so it needs
`SameSite=None; Secure`. That requires `COOKIE_SECURE=true`, which in turn
requires `TRUST_PROXY=true`, because Caddy terminates TLS and Express otherwise
believes the connection was plain HTTP and quietly declines to set a secure
cookie. Both are hard-coded true in `docker-compose.prod.yml`; if you have
overridden them, that is the cause.

**CORS errors in the console.** `FRONTEND_URL` must be the exact origin —
scheme and host, no trailing slash, no path. A Vercel *preview* deployment gets
a different hostname on every push and will be rejected unless you add it to
the comma-separated list.

**The WebSocket closes immediately.** Same origin rule, checked separately:
CORS middleware does not cover WebSocket handshakes, so the pose service tests
`Origin` against `ALLOWED_ORIGINS` itself. Both compose files feed it from
`FRONTEND_URL`.

**Certificate never issues.** Caddy needs port 80 reachable from the internet
for the ACME challenge and the A record already resolving. Let's Encrypt rate-
limits failed attempts hard, so uncomment the `acme_ca` staging line in the
`Caddyfile` while you sort DNS out, then comment it back.

**The pose service never becomes healthy.** `docker compose logs pose-service`.
If it is being OOM-killed the instance is too small — see the sizing note in §1.

**The backend exits at start.** It validates its whole environment at boot and
names the missing variable. Most often SMTP: all three of `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASSWORD` are required when `NODE_ENV=production`.

---

## 8. Licence note

The pose service depends on `ultralytics` (YOLOv8), which is **AGPL-3.0**. That
is a copyleft licence covering network use: hosting this service publicly
obliges you to offer its source under the same terms. Fine for academic work,
a real constraint on anything commercial.
