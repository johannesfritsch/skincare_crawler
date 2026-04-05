# AnySkin Crawler

Monorepo with two packages:

- **server/** — Payload CMS + Next.js admin UI, work protocol API
- **worker/** — Standalone Node.js process that claims and processes jobs

## Local Development

### Server

```bash
cd server
cp .env.example .env   # fill in DATABASE_URL, PAYLOAD_SECRET etc.
pnpm install
pnpm payload migrate   # apply pending migrations
pnpm dev               # http://localhost:3000
```

### Worker

```bash
cd worker
cp .env.example .env   # fill in WORKER_SERVER_URL, WORKER_API_KEY, OPENAI_API_KEY
pnpm install
pnpm worker
```

### Local Setup Script

For installing system dependencies on your dev machine:

```bash
chmod +x setup.sh && ./setup.sh
```

## Server Deployment (Ubuntu)

### Prerequisites

- A fresh Ubuntu 22.04+ server (Hetzner, AWS, etc.)
- SSH access as root
- A GitHub deploy key configured for the repo

### 1. Upload the deploy script

From your local machine:

```bash
scp deploy.sh root@your-server:/srv/anyskin/deploy.sh
ssh root@your-server "chmod +x /srv/anyskin/deploy.sh"
```

### 2. One-time server setup

SSH into the server and run:

```bash
ssh root@your-server
cd /srv/anyskin
./deploy.sh setup
```

This installs: Node.js, pnpm, PM2, PostgreSQL, ffmpeg, yt-dlp, gallery-dl, zbar, libvips, libomp, Playwright Chromium. Creates the PostgreSQL user and base directory.

### 3. Configure GitHub deploy key

On the server, generate an SSH key and add it as a deploy key in GitHub:

```bash
ssh-keygen -t ed25519 -C "anyskin-deploy" -f ~/.ssh/anyskin_deploy -N ""
cat ~/.ssh/anyskin_deploy.pub
# → Add this as a deploy key in GitHub repo settings (read-only is fine)
```

Add to SSH config so git uses the right key:

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/anyskin_deploy
  IdentitiesOnly yes
EOF
```

Test: `ssh -T git@github.com` (should say "successfully authenticated").

### 4. Initialize an environment

```bash
# Staging with 2 workers
./deploy.sh init staging --workers 2

# Production with 1 worker
./deploy.sh init prod --workers 1
```

This clones the repo, installs dependencies, creates the database, scaffolds `.env` files, runs migrations, and generates a PM2 config.

### 5. Configure environment

Edit the generated `.env` files:

```bash
# Server config (DB is pre-configured, fill in SMTP, S3, etc.)
nano /srv/anyskin/staging/server/.env

# Worker config (set API keys — create workers in admin UI first)
nano /srv/anyskin/staging/worker/.env.1
nano /srv/anyskin/staging/worker/.env.2
```

Each worker needs a unique `WORKER_API_KEY`:
1. Start the server: `./deploy.sh start staging`
2. Go to the admin UI → Workers collection → Create a worker for each instance
3. Copy each worker's API key into the corresponding `worker/.env.N` file
4. Restart: `./deploy.sh restart staging`

### 6. Start processes

```bash
./deploy.sh start staging
```

### 7. Ongoing deployments

When you push new code to `main`:

```bash
./deploy.sh deploy staging   # pulls latest, installs, migrates, restarts
./deploy.sh deploy prod
```

### Deploy CLI Reference

```
./deploy.sh setup                     # One-time server setup
./deploy.sh init <env> [--workers N]  # Initialize environment
./deploy.sh deploy <env>              # Deploy latest code
./deploy.sh start <env>               # Start processes
./deploy.sh stop <env>                # Stop processes
./deploy.sh restart <env>             # Restart processes
./deploy.sh logs <env> [service]      # Tail logs (server, worker, worker-N)
./deploy.sh status [env]              # Show status
./deploy.sh env <env>                 # Show .env file paths
./deploy.sh help                      # Show help
```

Environments: `staging` (port 3001), `prod` (port 3000).

### Server Layout

```
/srv/anyskin/
├── deploy.sh
├── staging/
│   ├── server/.env           # DB, SMTP, S3, etc.
│   ├── worker/.env.1         # Worker 1 (unique API key)
│   ├── worker/.env.2         # Worker 2 (unique API key)
│   └── pm2.config.cjs        # PM2 process config
└── prod/
    ├── server/.env
    ├── worker/.env.1
    └── pm2.config.cjs
```

## Testing

The worker has a Vitest test suite covering driver parsing logic and helper functions. No database or network access is needed — tests run against recorded HTTP fixtures.

```bash
cd worker
pnpm test              # run all tests (~600ms)
pnpm test:watch        # watch mode (re-runs on file changes)
```

### Recording new fixtures

To record live HTTP responses as test fixtures for a driver:

```bash
pnpm test:record <driver> <url>
```

Supported drivers: `dm`, `purish`, `shopapotheke`

Examples:

```bash
pnpm test:record dm "https://www.dm.de/some-product-p4066447240092.html"
pnpm test:record purish "https://purish.com/products/some-product"
pnpm test:record shopapotheke "https://www.shop-apotheke.com/beauty/sku/product.htm"
```

This saves the raw HTTP responses to `worker/tests/fixtures/<driver>/<slug>/`. Then run the matching snapshot test to generate the golden snapshot:

```bash
pnpm test              # first run saves expected.snapshot.json
```

### Updating snapshots

When you intentionally change parsing logic, regenerate golden snapshots:

```bash
UPDATE_SNAPSHOTS=1 pnpm test
```

Review the diff in `tests/fixtures/*/expected.snapshot.json` to confirm the changes are correct.

## Work Protocol

Jobs are created in the admin UI and processed by workers via HTTP:

```
POST /api/work/claim     — claim a unit of work
POST /api/work/submit    — submit results
POST /api/work/heartbeat — keep alive during long jobs
```
