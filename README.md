# AnySkin Crawler

Monorepo with two packages:

- **server/** — Payload CMS + Next.js admin UI, work protocol API
- **worker/** — Standalone Node.js process that claims and processes jobs

## Quick Start

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

### Docker (Optional)

```bash
cd server
docker-compose up      # starts MongoDB, uses .env automatically
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