# AnySkin Crawler

Monorepo with two packages:

- **server/** — Payload CMS + Next.js admin UI, work protocol API
- **worker/** — Standalone Node.js process that claims and processes jobs

## Quick Start

### Server

```bash
cd server
cp .env.example .env   # fill in MONGODB_URL etc.
pnpm install
pnpm dev               # http://localhost:3000
```

### Worker

```bash
cd worker
cp .env.example .env   # fill in WORKER_SERVER_URL, WORKER_API_KEY, OPENAI_API_KEY
pnpm install
pnpm worker
```

### Docker (Optional)

```bash
cd server
docker-compose up      # starts MongoDB, uses .env automatically
```

## Work Protocol

Jobs are created in the admin UI and processed by workers via HTTP:

```
POST /api/work/claim     — claim a unit of work
POST /api/work/submit    — submit results
POST /api/work/heartbeat — keep alive during long jobs
```
