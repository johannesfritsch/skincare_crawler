# Payload CMS Development Rules

You are an expert Payload CMS developer. When working with Payload projects, follow these rules:

## Core Principles

1. **TypeScript-First**: Always use TypeScript with proper types from Payload
2. **Security-Critical**: Follow all security patterns, especially access control
3. **Type Generation**: Run `generate:types` script after schema changes
4. **Transaction Safety**: Always pass `req` to nested operations in hooks
5. **Access Control**: Understand Local API bypasses access control by default
6. **Access Control**: Ensure roles exist when modifiyng collection or globals with access controls

### Code Validation

- To validate typescript correctness after modifying code run `tsc --noEmit`
- Generate import maps after creating or modifying components.

### Migrations

The project uses **migration-based schema management** (not `push`). `push: false` is set on the Postgres adapter — all schema changes require a migration, even in dev.

**Workflow after modifying collection configs:**

1. Run `pnpm payload migrate:create` in the server directory to generate a migration file
2. Review the generated migration in `src/migrations/` — verify the SQL is correct
3. Include the migration file in commits (the developer will apply it with `pnpm payload migrate`)

**Rules:**
- **CRITICAL: NEVER hand-write migration files.** Always use `pnpm payload migrate:create` to generate migrations. Each generated migration is a pair: a `.ts` file (SQL) and a `.json` file (schema snapshot). Payload diffs the current schema against the **most recent `.json` snapshot** to compute what changed. Hand-written migrations without a companion `.json` cause Payload to lose track of the schema state, leading to `migrate:create` generating duplicate SQL for changes that already exist.
- If `migrate:create` prompts interactively (e.g. "created or renamed?"), the developer must answer those prompts — do not try to bypass them. Flag this to the developer and let them run the command.
- Always run `pnpm payload migrate:create` after changing collection fields, adding/removing collections, or modifying indexes
- Do NOT run `pnpm payload migrate` yourself — applying migrations is the developer's responsibility
- Migrations live in `server/src/migrations/` — the `index.ts` barrel file is auto-generated

## Project Structure

```
src/
├── app/
│   ├── (frontend)/              # Consumer-facing frontend
│   │   ├── layout.tsx           # Root layout (html/body, PWA meta)
│   │   ├── page.tsx             # Redirect to /discover
│   │   ├── globals.css          # Tailwind theme, brand colors, PWA overrides
│   │   └── (tabs)/              # Tab-based pages with bottom nav
│   │       ├── layout.tsx       # App shell (header + bottom nav)
│   │       ├── discover/        # Top-rated products
│   │       ├── videos/          # Video feed
│   │       ├── products/        # Search + detail + 404
│   │       ├── lists/           # Top lists by product type
│   │       └── profile/         # User profile (placeholder)
│   └── (payload)/               # Payload admin routes
├── collections/                 # Collection configs
├── globals/                     # Global configs
├── actions/
│   └── job-actions.ts           # Server actions: create jobs + poll status (shared by all JobButtons)
├── components/                  # Shared React components
│   ├── ui/                      # shadcn/ui primitives
│   ├── JobButton.tsx            # Shared job button with state machine + polling (used by all SaveButton wrappers)
│   ├── BulkJobBar.tsx           # Shared bulk action bar for list views (useSelection + polling, renders when items selected)
│   ├── *SaveButton.tsx          # Per-collection SaveButton wrappers (SourceProduct, Product, Video, Channel, Ingredient)
│   ├── SourceUrlField.tsx       # Custom Field for sourceUrl edit view (store logo + link + copy + edit)
│   ├── SourceUrlCell.tsx        # Custom Cell for source/sourceUrl list view (logo + store name + external link)
│   ├── bulk-actions/            # Per-collection beforeListTable wrappers for bulk job actions
│   ├── anyskin-logo.tsx         # SVG wordmark
│   ├── bottom-nav.tsx           # 5-tab bottom navigation
│   ├── app-drawer.tsx           # Burger menu drawer
│   ├── barcode-scanner.tsx      # Camera barcode scanner
│   ├── product-card.tsx         # Product card for carousels
│   └── product-search.tsx       # Search input component
├── lib/
│   ├── barcode.ts               # Barcode detection (native + zxing-wasm)
│   ├── score-utils.tsx           # Score tier system, ScoreBadge (server-safe, no 'use client')
│   └── utils.ts                 # shadcn cn() utility
├── types/
│   └── barcode-detector.d.ts    # BarcodeDetector Web API types
├── hooks/
│   ├── enforceJobClaim.ts       # beforeChange hook: distributed job locking via claimedBy/claimedAt
│   ├── resetJobOnPending.ts     # beforeChange hook factory: resets progress/counters when status → pending
│   ├── jobClaimFields.ts        # Shared claimedBy + claimedAt field definitions for job collections
│   ├── jobScheduleFields.ts     # Shared status field (5 options), schedule + scheduledFor fields, exclude-list for reschedule
│   └── rescheduleOnComplete.ts  # afterChange hook factory: creates next scheduled job when recurring job completes
├── access/                      # Access control functions
└── payload.config.ts            # Main config
```

## Configuration

### Minimal Config Pattern

```typescript
import { buildConfig } from 'payload'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: 'users',
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URL,
  }),
})
```

## Collections

### Basic Collection

```typescript
import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'status', 'createdAt'],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true, index: true },
    { name: 'content', type: 'richText' },
    { name: 'author', type: 'relationship', relationTo: 'users' },
  ],
  timestamps: true,
}
```

### Auth Collection with RBAC

```typescript
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'editor', 'user'],
      defaultValue: ['user'],
      required: true,
      saveToJWT: true, // Include in JWT for fast access checks
      access: {
        update: ({ req: { user } }) => user?.roles?.includes('admin'),
      },
    },
  ],
}
```

## Fields

### Common Patterns

```typescript
// Auto-generate slugs
import { slugField } from 'payload'
slugField({ fieldToUse: 'title' })

// Relationship with filtering
{
  name: 'category',
  type: 'relationship',
  relationTo: 'categories',
  filterOptions: { active: { equals: true } },
}

// Conditional field
{
  name: 'featuredImage',
  type: 'upload',
  relationTo: 'media',
  admin: {
    condition: (data) => data.featured === true,
  },
}

// Virtual field
{
  name: 'fullName',
  type: 'text',
  virtual: true,
  hooks: {
    afterRead: [({ siblingData }) => `${siblingData.firstName} ${siblingData.lastName}`],
  },
}
```

## CRITICAL SECURITY PATTERNS

### 1. Local API Access Control (MOST IMPORTANT)

```typescript
// ❌ SECURITY BUG: Access control bypassed
await payload.find({
  collection: 'posts',
  user: someUser, // Ignored! Operation runs with ADMIN privileges
})

// ✅ SECURE: Enforces user permissions
await payload.find({
  collection: 'posts',
  user: someUser,
  overrideAccess: false, // REQUIRED
})

// ✅ Administrative operation (intentional bypass)
await payload.find({
  collection: 'posts',
  // No user, overrideAccess defaults to true
})
```

**Rule**: When passing `user` to Local API, ALWAYS set `overrideAccess: false`

### 2. Transaction Safety in Hooks

```typescript
// ❌ DATA CORRUPTION RISK: Separate transaction
hooks: {
  afterChange: [
    async ({ doc, req }) => {
      await req.payload.create({
        collection: 'audit-log',
        data: { docId: doc.id },
        // Missing req - runs in separate transaction!
      })
    },
  ],
}

// ✅ ATOMIC: Same transaction
hooks: {
  afterChange: [
    async ({ doc, req }) => {
      await req.payload.create({
        collection: 'audit-log',
        data: { docId: doc.id },
        req, // Maintains atomicity
      })
    },
  ],
}
```

**Rule**: ALWAYS pass `req` to nested operations in hooks

### 3. Prevent Infinite Hook Loops

```typescript
// ❌ INFINITE LOOP
hooks: {
  afterChange: [
    async ({ doc, req }) => {
      await req.payload.update({
        collection: 'posts',
        id: doc.id,
        data: { views: doc.views + 1 },
        req,
      }) // Triggers afterChange again!
    },
  ],
}

// ✅ SAFE: Use context flag
hooks: {
  afterChange: [
    async ({ doc, req, context }) => {
      if (context.skipHooks) return

      await req.payload.update({
        collection: 'posts',
        id: doc.id,
        data: { views: doc.views + 1 },
        context: { skipHooks: true },
        req,
      })
    },
  ],
}
```

## Access Control

### Collection-Level Access

```typescript
import type { Access } from 'payload'

// Boolean return
const authenticated: Access = ({ req: { user } }) => Boolean(user)

// Query constraint (row-level security)
const ownPostsOnly: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user?.roles?.includes('admin')) return true

  return {
    author: { equals: user.id },
  }
}

// Async access check
const projectMemberAccess: Access = async ({ req, id }) => {
  const { user, payload } = req

  if (!user) return false
  if (user.roles?.includes('admin')) return true

  const project = await payload.findByID({
    collection: 'projects',
    id: id as string,
    depth: 0,
  })

  return project.members?.includes(user.id)
}
```

### Field-Level Access

```typescript
// Field access ONLY returns boolean (no query constraints)
{
  name: 'salary',
  type: 'number',
  access: {
    read: ({ req: { user }, doc }) => {
      // Self can read own salary
      if (user?.id === doc?.id) return true
      // Admin can read all
      return user?.roles?.includes('admin')
    },
    update: ({ req: { user } }) => {
      // Only admins can update
      return user?.roles?.includes('admin')
    },
  },
}
```

### Common Access Patterns

```typescript
// Anyone
export const anyone: Access = () => true

// Authenticated only
export const authenticated: Access = ({ req: { user } }) => Boolean(user)

// Admin only
export const adminOnly: Access = ({ req: { user } }) => {
  return user?.roles?.includes('admin')
}

// Admin or self
export const adminOrSelf: Access = ({ req: { user } }) => {
  if (user?.roles?.includes('admin')) return true
  return { id: { equals: user?.id } }
}

// Published or authenticated
export const authenticatedOrPublished: Access = ({ req: { user } }) => {
  if (user) return true
  return { _status: { equals: 'published' } }
}
```

## Hooks

### Common Hook Patterns

```typescript
import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  hooks: {
    // Before validation - format data
    beforeValidate: [
      async ({ data, operation }) => {
        if (operation === 'create') {
          data.slug = slugify(data.title)
        }
        return data
      },
    ],

    // Before save - business logic
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        if (operation === 'update' && data.status === 'published') {
          data.publishedAt = new Date()
        }
        return data
      },
    ],

    // After save - side effects
    afterChange: [
      async ({ doc, req, operation, previousDoc, context }) => {
        // Check context to prevent loops
        if (context.skipNotification) return

        if (operation === 'create') {
          await sendNotification(doc)
        }
        return doc
      },
    ],

    // After read - computed fields
    afterRead: [
      async ({ doc, req }) => {
        doc.viewCount = await getViewCount(doc.id)
        return doc
      },
    ],

    // Before delete - cascading deletes
    beforeDelete: [
      async ({ req, id }) => {
        await req.payload.delete({
          collection: 'comments',
          where: { post: { equals: id } },
          req, // Important for transaction
        })
      },
    ],
  },
}
```

## Queries

### Local API

```typescript
// Find with complex query
const posts = await payload.find({
  collection: 'posts',
  where: {
    and: [{ status: { equals: 'published' } }, { 'author.name': { contains: 'john' } }],
  },
  depth: 2, // Populate relationships
  limit: 10,
  sort: '-createdAt',
  select: {
    title: true,
    author: true,
  },
})

// Find by ID
const post = await payload.findByID({
  collection: 'posts',
  id: '123',
  depth: 2,
})

// Create
const newPost = await payload.create({
  collection: 'posts',
  data: {
    title: 'New Post',
    status: 'draft',
  },
})

// Update
await payload.update({
  collection: 'posts',
  id: '123',
  data: { status: 'published' },
})

// Delete
await payload.delete({
  collection: 'posts',
  id: '123',
})
```

### Query Operators

```typescript
// Equals
{ status: { equals: 'published' } }

// Not equals
{ status: { not_equals: 'draft' } }

// Greater than / less than
{ price: { greater_than: 100 } }
{ age: { less_than_equal: 65 } }

// Contains (case-insensitive)
{ title: { contains: 'payload' } }

// Like (all words present)
{ description: { like: 'cms headless' } }

// In array
{ category: { in: ['tech', 'news'] } }

// Exists
{ image: { exists: true } }

// Near (geospatial)
{ location: { near: [-122.4194, 37.7749, 10000] } }
```

### AND/OR Logic

```typescript
{
  or: [
    { status: { equals: 'published' } },
    { author: { equals: user.id } },
  ],
}

{
  and: [
    { status: { equals: 'published' } },
    { featured: { equals: true } },
  ],
}
```

## Getting Payload Instance

```typescript
// In API routes (Next.js)
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET() {
  const payload = await getPayload({ config })

  const posts = await payload.find({
    collection: 'posts',
  })

  return Response.json(posts)
}

// In Server Components
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function Page() {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'posts' })

  return <div>{docs.map(post => <h1 key={post.id}>{post.title}</h1>)}</div>
}
```

## Components

The Admin Panel can be extensively customized using React Components. Custom Components can be Server Components (default) or Client Components.

### Defining Components

Components are defined using **file paths** (not direct imports) in your config:

**Component Path Rules:**

- Paths are relative to project root or `config.admin.importMap.baseDir`
- Named exports: use `#ExportName` suffix or `exportName` property
- Default exports: no suffix needed
- File extensions can be omitted

```typescript
import { buildConfig } from 'payload'

export default buildConfig({
  admin: {
    components: {
      // Logo and branding
      graphics: {
        Logo: '/components/Logo',
        Icon: '/components/Icon',
      },

      // Navigation
      Nav: '/components/CustomNav',
      beforeNavLinks: ['/components/CustomNavItem'],
      afterNavLinks: ['/components/NavFooter'],

      // Header
      header: ['/components/AnnouncementBanner'],
      actions: ['/components/ClearCache', '/components/Preview'],

      // Dashboard
      beforeDashboard: ['/components/WelcomeMessage'],
      afterDashboard: ['/components/Analytics'],

      // Auth
      beforeLogin: ['/components/SSOButtons'],
      logout: { Button: '/components/LogoutButton' },

      // Settings
      settingsMenu: ['/components/SettingsMenu'],

      // Views
      views: {
        dashboard: { Component: '/components/CustomDashboard' },
      },
    },
  },
})
```

**Component Path Rules:**

- Paths are relative to project root or `config.admin.importMap.baseDir`
- Named exports: use `#ExportName` suffix or `exportName` property
- Default exports: no suffix needed
- File extensions can be omitted

### Component Types

1. **Root Components** - Global Admin Panel (logo, nav, header)
2. **Collection Components** - Collection-specific (edit view, list view)
3. **Global Components** - Global document views
4. **Field Components** - Custom field UI and cells

### Component Types

1. **Root Components** - Global Admin Panel (logo, nav, header)
2. **Collection Components** - Collection-specific (edit view, list view)
3. **Global Components** - Global document views
4. **Field Components** - Custom field UI and cells

### Server vs Client Components

**All components are Server Components by default** (can use Local API directly):

```tsx
// Server Component (default)
import type { Payload } from 'payload'

async function MyServerComponent({ payload }: { payload: Payload }) {
  const posts = await payload.find({ collection: 'posts' })
  return <div>{posts.totalDocs} posts</div>
}

export default MyServerComponent
```

**Client Components** need the `'use client'` directive:

```tsx
'use client'
import { useState } from 'react'
import { useAuth } from '@payloadcms/ui'

export function MyClientComponent() {
  const [count, setCount] = useState(0)
  const { user } = useAuth()

  return (
    <button onClick={() => setCount(count + 1)}>
      {user?.email}: Clicked {count} times
    </button>
  )
}
```

### Using Hooks (Client Components Only)

```tsx
'use client'
import {
  useAuth, // Current user
  useConfig, // Payload config (client-safe)
  useDocumentInfo, // Document info (id, collection, etc.)
  useField, // Field value and setter
  useForm, // Form state
  useFormFields, // Multiple field values (optimized)
  useLocale, // Current locale
  useTranslation, // i18n translations
  usePayload, // Local API methods
} from '@payloadcms/ui'

export function MyComponent() {
  const { user } = useAuth()
  const { config } = useConfig()
  const { id, collection } = useDocumentInfo()
  const locale = useLocale()
  const { t } = useTranslation()

  return <div>Hello {user?.email}</div>
}
```

### Collection/Global Components

```typescript
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    components: {
      // Edit view
      edit: {
        PreviewButton: '/components/PostPreview',
        SaveButton: '/components/CustomSave',
        SaveDraftButton: '/components/SaveDraft',
        PublishButton: '/components/Publish',
      },

      // List view
      list: {
        Header: '/components/ListHeader',
        beforeList: ['/components/BulkActions'],
        afterList: ['/components/ListFooter'],
      },
    },
  },
}
```

### List Menu Items (batch / utility actions)

`listMenuItems` injects entries into the "..." kebab menu on the collection list view. Use this for batch operations (applied to selected rows) and for utility actions that don't fit the bulk-action bar.

**Two patterns are used in this codebase:**

#### 1. Batch job actions (selection-dependent) — `BulkJobMenuItem`

For operations that run a background job against the currently selected rows. Use `BulkJobMenuItem` from `BulkJobBar.tsx`:

```tsx
// components/bulk-actions/ProductBulkActions.tsx
'use client'

import { BulkJobMenuItem } from '@/components/BulkJobBar'
import { bulkAggregateProducts } from '@/actions/job-actions'

export default function ProductBulkMenuItem() {
  return (
    <BulkJobMenuItem
      label="Aggregate"
      createJob={bulkAggregateProducts}
      jobCollection="product-aggregations"
    />
  )
}
```

```typescript
// In the collection config:
admin: {
  components: {
    listMenuItems: ['@/components/bulk-actions/ProductBulkActions'],
    beforeListTable: ['@/components/bulk-actions/ProductBulkStatus'], // job status bar
  },
}
```

`BulkJobMenuItem` automatically reads the current selection via `useSelection()`, disables itself when nothing is selected, and shows live job state via the shared pub/sub store. The companion `beforeListTable` component (`*BulkStatus.tsx`) renders the status bar above the table.

#### 2. Simple utility actions (no selection needed) — plain `<button>`

For actions that don't operate on a selection (e.g. seeding defaults, triggering a global refresh). Use a plain `<button>` with `className="popup-button-list__button"` — this is the Payload CSS class that makes the item look native inside the menu:

```tsx
// components/SeedProductTypesButton.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SeedProductTypesButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      await myAction()
      router.refresh()
    } catch (err) {
      console.error('Action failed', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleClick}
      className="popup-button-list__button"
      style={{ whiteSpace: 'nowrap', opacity: loading ? 0.5 : 1 }}
    >
      {loading ? 'Loading...' : 'My Action'}
    </button>
  )
}
```

```typescript
// In the collection config:
admin: {
  components: {
    listMenuItems: ['/components/SeedProductTypesButton'],
  },
}
```

**Rules:**
- Always use `className="popup-button-list__button"` — never Payload's `<Button>` component or raw styled `<button>` elements in this slot; they will look out of place.
- Do NOT use `beforeList` for actions — use `listMenuItems` so the action lives in the menu where Payload intends it.
- Feedback: utility actions should call `router.refresh()` on success and log errors to `console.error`. There is no persistent space for inline feedback inside a menu item.

### Job Status on Detail Pages

Each collection that has a per-document job action (Crawl, Aggregate, etc.) shows a live job status bar on the edit view. This is wired up with two pieces:

#### 1. `SaveButton` replacement — `*SaveButton.tsx`

Replace the standard save button via `admin.components.edit.SaveButton`. The custom component renders the native `<SaveButton />` next to a `<JobButton>` that creates the job and publishes state into the shared pub/sub store:

```tsx
// components/SourceProductSaveButton.tsx
'use client'

import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { crawlSourceProduct, getJobStatus } from '@/actions/job-actions'

export default function SourceProductSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const router = useRouter()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <JobButton
          label="Crawl"
          runningLabel="Crawling..."
          createJob={() => crawlSourceProduct(Number(id))}
          getStatus={(jobId) => getJobStatus('product-crawls', jobId)}
          jobCollection="product-crawls"
          onCompleted={() => router.refresh()}
        />
      )}
    </div>
  )
}
```

`JobButton` props:
- `label` / `runningLabel` — button text in idle vs active state
- `createJob` — server action that creates the job, returns `{ success, jobId?, error? }`
- `getStatus` — server action that polls the job, returns `{ status, errors? }`
- `jobCollection` — the job collection slug; used to publish state into the shared pub/sub store so the co-located `JobStatusBar` can render the live event log
- `onCompleted` — callback on success (typically `router.refresh()`)

#### 2. Status bar `ui` field — `*JobStatus.tsx`

A `type: 'ui'` field placed **before the tabs block** in the collection config renders the live event log below the header. The component is a thin wrapper around `JobStatusBar` from `BulkJobBar.tsx`:

```tsx
// components/SourceProductJobStatus.tsx
'use client'

import { JobStatusBar } from '@/components/BulkJobBar'

export default function SourceProductJobStatus() {
  return <JobStatusBar runningLabel="Crawling..." jobCollection="product-crawls" />
}
```

```typescript
// In the collection config — place the ui field BEFORE the tabs field:
fields: [
  // ... sidebar fields (status, source, etc.) ...
  {
    name: 'crawlStatus',   // arbitrary name, not stored
    type: 'ui',
    admin: {
      components: {
        Field: '@/components/SourceProductJobStatus',
      },
    },
  },
  {
    type: 'tabs',
    tabs: [ /* ... */ ],
  },
]
```

**How the pub/sub works:** `JobButton` and `BulkJobMenuItem` both write into a module-level store (exported as `getJobState`/`setJobState` from `BulkJobBar.tsx`), keyed by `jobCollection`. `JobStatusBar` subscribes to that store and renders the event log. Because both components reference the same `jobCollection` key, the status bar automatically reflects whatever the button last triggered — no prop threading required.

**Per-collection wiring summary:**

| Collection | SaveButton | JobStatus component | `jobCollection` |
|---|---|---|---|
| `source-products` | `SourceProductSaveButton` | `SourceProductJobStatus` | `product-crawls` |
| `products` | `ProductSaveButton` | `ProductJobStatus` | `product-aggregations` |
| `videos` | `VideoSaveButton` | `VideoJobStatus` | `video-crawls` + `video-processings` |
| `channels` | `ChannelSaveButton` | `ChannelJobStatus` | `video-discoveries` + `video-crawls` |
| `ingredients` | `IngredientSaveButton` | `IngredientJobStatus` | `ingredient-crawls` |

### Field Components

```typescript
{
  name: 'status',
  type: 'select',
  options: ['draft', 'published'],
  admin: {
    components: {
      // Edit view field
      Field: '/components/StatusField',
      // List view cell
      Cell: '/components/StatusCell',
      // Field label
      Label: '/components/StatusLabel',
      // Field description
      Description: '/components/StatusDescription',
      // Error message
      Error: '/components/StatusError',
    },
  },
}
```

**UI Field** (presentational only, no data):

```typescript
{
  name: 'refundButton',
  type: 'ui',
  admin: {
    components: {
      Field: '/components/RefundButton',
    },
  },
}
```

**Custom Field on Data-Storing Fields** — `SourceUrlField`:

The `sourceUrl` field on `source-products` and `source-variants` uses custom `Field` and `Cell` components that share utilities from `store-fields.ts` (`detectStoreFromUrl`, `shortenUrl`, `STORE_LABELS`) and `store-logos.tsx` (`StoreLogo`). Icons come from `lucide-react`.

- **`SourceUrlField`** (edit view) — replaces the default text input with a visual widget: store logo (auto-detected from URL hostname via `detectStoreFromUrl`, or from sibling `source` field via `useFormFields`), truncated URL text, clickable external link, copy-to-clipboard button, and an edit button to reveal the raw text input. Uses `useField` for data binding. This is the first instance of a custom `Field` component on a real data field (as opposed to `type: 'ui'`).

- **`SourceUrlCell`** (list view) — renders a store logo + store name as a clickable external link to the product page. Applied to the `source` field on `source-products` and the `sourceUrl` field on `source-variants`. Works on both: when on a select field it reads `sourceUrl` from `rowData`; when on a text field it detects the store from the hostname. Uses `e.stopPropagation()` so clicks open the external URL without navigating to the Payload edit view.

### Performance Best Practices

1. **Import correctly:**

   - Admin Panel: `import { Button } from '@payloadcms/ui'`
   - Frontend: `import { Button } from '@payloadcms/ui/elements/Button'`

2. **Optimize re-renders:**

   ```tsx
   // ❌ BAD: Re-renders on every form change
   const { fields } = useForm()

   // ✅ GOOD: Only re-renders when specific field changes
   const value = useFormFields(([fields]) => fields[path])
   ```

3. **Prefer Server Components** - Only use Client Components when you need:

   - State (useState, useReducer)
   - Effects (useEffect)
   - Event handlers (onClick, onChange)
   - Browser APIs (localStorage, window)

4. **Minimize serialized props** - Server Components serialize props sent to client

### Using `@payloadcms/ui` Components

When building custom admin components, always use Payload's built-in UI primitives from `@payloadcms/ui` instead of raw HTML elements. This ensures visual consistency with the rest of the admin panel and automatic theme support (light/dark mode, spacing, typography).

Key components:

- `Button` — primary UI button. Props: `buttonStyle` (`'primary'`, `'secondary'`, `'error'`, `'pill'`, `'subtle'`), `size` (`'small'`, `'medium'`, `'large'`), `disabled`, `tooltip`, `type`, `onClick`. Use this for any clickable action in custom views.
- `SaveButton` — the standard document save button. Use alongside custom buttons (e.g. `<SaveButton />` + `<Button>Crawl</Button>`).
- `useDocumentInfo()` — hook to get `id`, `collection`, etc. in client components.
- `useField(path)` / `useFormFields(selector)` — hooks for reading field values.

Import from the top-level package in admin components:

```tsx
import { Button, SaveButton, useDocumentInfo } from '@payloadcms/ui'
```

Do **not** roll custom styled `<button>` elements — they will look out of place and break when Payload updates its theme.

### Styling Components

```tsx
import './styles.scss'

export function MyComponent() {
  return <div className="my-component">Content</div>
}
```

```scss
// Use Payload's CSS variables
.my-component {
  background-color: var(--theme-elevation-500);
  color: var(--theme-text);
  padding: var(--base);
  border-radius: var(--border-radius-m);
}

// Import Payload's SCSS library
@import '~@payloadcms/ui/scss';

.my-component {
  @include mid-break {
    background-color: var(--theme-elevation-900);
  }
}
```

### Type Safety

```tsx
import type {
  TextFieldServerComponent,
  TextFieldClientComponent,
  TextFieldCellComponent,
  SelectFieldServerComponent,
  // ... etc
} from 'payload'

export const MyField: TextFieldClientComponent = (props) => {
  // Fully typed props
}
```

### Import Map

Payload auto-generates `app/(payload)/admin/importMap.js` to resolve component paths.

**Regenerate manually:**

```bash
payload generate:importmap
```

**Set custom location:**

```typescript
export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname, 'src'),
      importMapFile: path.resolve(dirname, 'app', 'custom-import-map.js'),
    },
  },
})
```

## Authentication & Authorization

Two independent auth systems run side-by-side — JWT for admin users, API keys for workers.

### Admin Users (`users` collection)

- **Mechanism**: Payload CMS built-in JWT auth (`auth: true` on the collection)
- **Login**: `/admin/login` — Payload auto-generates login UI and JWT handling
- **Token storage**: HTTP-only cookie, auto-attached to all admin UI requests
- **JWT secret**: `PAYLOAD_SECRET` env var (required)
- **`req.user`**: Payload populates this on every request from the JWT cookie — all access control and custom endpoints read from it

### Workers (`workers` collection)

- **Mechanism**: Payload API key auth (`auth: { useAPIKey: true, disableLocalStrategy: true }`)
- **No password login** — `disableLocalStrategy: true` means workers can only auth via API key
- **API key generation**: Payload auto-generates a key when a worker record is created in the admin UI
- **Header format**: `Authorization: workers API-Key <key>` (custom scheme — `workers` is the collection slug, not `Bearer`)
- **`req.user`**: Payload populates this from the API key header, same as JWT — downstream code doesn't need to distinguish between admin and worker auth
- **Fields**: `name` (identifier), `capabilities[]` (which job types it can process), `status` (active/disabled), `lastSeenAt` (updated by heartbeat)

### Access Control Pattern

All custom endpoints guard with the same check:

```typescript
if (!req.user) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
```

This covers both auth methods — `req.user` is set by Payload for JWT cookies (admin) and API key headers (workers) alike. Collection-level access control uses Payload's standard `access` functions (see Access Control section below).

### Endpoint Auth Summary

| Endpoint | Auth | Consumers |
|----------|------|-----------|
| `/api/<collection>` (Payload REST) | JWT or API key | Admin UI, workers |
| `/api/work-items/*` | API key (`req.user`) | Workers only |
| `/api/embeddings/:namespace/*` | JWT or API key (`req.user`) | Workers (write/search), admin (search) |
| `/api/dashboard/events` | JWT (`req.user`) | Admin dashboard |
| `/api/dashboard/snapshot` | JWT (`req.user`) | Admin dashboard |

### Job Claim Locking (`hooks/enforceJobClaim.ts`)

A `beforeChange` hook on all job collections prevents concurrent claims:

1. If no existing `claimedBy` → allow claim
2. If same worker refreshing its own claim → allow
3. If different worker, existing claim is fresh (within `X-Job-Timeout-Minutes`, default 30m) → **reject** (throws error)
4. If different worker, existing claim is stale → allow takeover

Workers pass the timeout via `X-Job-Timeout-Minutes` request header. The hook runs inside Payload's DB transaction for atomicity.

### Job Scheduling

All 9 job collections support deferred and recurring execution via shared scheduling infrastructure.

**Shared fields** (`hooks/jobScheduleFields.ts`):
- `jobStatusField` — select with 5 options: pending, scheduled, in_progress, completed, failed. Replaces the inline status field in each collection.
- `jobScheduleFields` — two sidebar fields: `schedule` (cron expression with `CronExpressionField` component) and `scheduledFor` (read-only date, visible only when status=scheduled).
- `RESCHEDULE_EXCLUDE_FIELDS` — field names never copied when rescheduling (id, status, claim fields, timing fields).

**Reschedule hook** (`hooks/rescheduleOnComplete.ts`):
- `rescheduleOnComplete: CollectionAfterChangeHook` — a plain hook, not a factory
- Triggers on status transition to `completed` when `schedule` is set
- Reuses the same job: sets `status: 'scheduled'` + `scheduledFor` from next cron run
- No progress reset needed — the activation endpoint transitions to `pending`, and the worker's `build*Work()` re-initializes counters when claiming a pending job
- Job cycles: `scheduled → pending → in_progress → completed → scheduled → ...`
- Uses `context.skipReschedule` to prevent infinite loops
- Emits `job.rescheduled` event

**Activation endpoint** (`endpoints/activate-scheduled.ts`):
- `POST /api/jobs/activate-scheduled` — transitions all `scheduled` jobs whose `scheduledFor ≤ now()` to `pending`
- Runs raw SQL UPDATE on all 9 job tables for efficiency
- Called by workers each poll cycle

**Cron editor** (`components/CronExpressionField.tsx`):
- Custom `TextFieldClientComponent` with preset buttons, human-readable description, next-3-runs preview, and validation via `croner`

## Custom Endpoints

```typescript
import type { Endpoint } from 'payload'
import { APIError } from 'payload'

// Always check authentication
export const protectedEndpoint: Endpoint = {
  path: '/protected',
  method: 'get',
  handler: async (req) => {
    if (!req.user) {
      throw new APIError('Unauthorized', 401)
    }

    // Use req.payload for database operations
    const data = await req.payload.find({
      collection: 'posts',
      where: { author: { equals: req.user.id } },
    })

    return Response.json(data)
  },
}

// Route parameters
export const trackingEndpoint: Endpoint = {
  path: '/:id/tracking',
  method: 'get',
  handler: async (req) => {
    const { id } = req.routeParams

    const tracking = await getTrackingInfo(id)

    if (!tracking) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    return Response.json(tracking)
  },
}
```

## Drafts & Versions

```typescript
export const Pages: CollectionConfig = {
  slug: 'pages',
  versions: {
    drafts: {
      autosave: true,
      schedulePublish: true,
      validate: false, // Don't validate drafts
    },
    maxPerDoc: 100,
  },
  access: {
    read: ({ req: { user } }) => {
      // Public sees only published
      if (!user) return { _status: { equals: 'published' } }
      // Authenticated sees all
      return true
    },
  },
}

// Create draft
await payload.create({
  collection: 'pages',
  data: { title: 'Draft Page' },
  draft: true, // Skips required field validation
})

// Read with drafts
const page = await payload.findByID({
  collection: 'pages',
  id: '123',
  draft: true, // Returns draft if available
})
```

## Field Type Guards

```typescript
import {
  fieldAffectsData,
  fieldHasSubFields,
  fieldIsArrayType,
  fieldIsBlockType,
  fieldSupportsMany,
  fieldHasMaxDepth,
} from 'payload'

function processField(field: Field) {
  // Check if field stores data
  if (fieldAffectsData(field)) {
    console.log(field.name) // Safe to access
  }

  // Check if field has nested fields
  if (fieldHasSubFields(field)) {
    field.fields.forEach(processField) // Safe to access
  }

  // Check field type
  if (fieldIsArrayType(field)) {
    console.log(field.minRows, field.maxRows)
  }

  // Check capabilities
  if (fieldSupportsMany(field) && field.hasMany) {
    console.log('Multiple values supported')
  }
}
```

## Plugins

### Using Plugins

```typescript
import { seoPlugin } from '@payloadcms/plugin-seo'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'

export default buildConfig({
  plugins: [
    seoPlugin({
      collections: ['posts', 'pages'],
    }),
    redirectsPlugin({
      collections: ['pages'],
    }),
  ],
})
```

### Creating Plugins

```typescript
import type { Config, Plugin } from 'payload'

interface MyPluginConfig {
  collections?: string[]
  enabled?: boolean
}

export const myPlugin =
  (options: MyPluginConfig): Plugin =>
  (config: Config): Config => ({
    ...config,
    collections: config.collections?.map((collection) => {
      if (options.collections?.includes(collection.slug)) {
        return {
          ...collection,
          fields: [...collection.fields, { name: 'pluginField', type: 'text' }],
        }
      }
      return collection
    }),
  })
```

## Best Practices

### Security

1. Always set `overrideAccess: false` when passing `user` to Local API
2. Field-level access only returns boolean (no query constraints)
3. Default to restrictive access, gradually add permissions
4. Never trust client-provided data
5. Use `saveToJWT: true` for roles to avoid database lookups

### Performance

1. Index frequently queried fields
2. Use `select` to limit returned fields
3. Set `maxDepth` on relationships to prevent over-fetching
4. Use query constraints over async operations in access control
5. Cache expensive operations in `req.context`

### Data Integrity

1. Always pass `req` to nested operations in hooks
2. Use context flags to prevent infinite hook loops
3. Enable transactions for MongoDB (requires replica set) and Postgres
4. Use `beforeValidate` for data formatting
5. Use `beforeChange` for business logic

### Type Safety

1. Run `generate:types` after schema changes
2. Import types from generated `payload-types.ts`
3. Type your user object: `import type { User } from '@/payload-types'`
4. Use `as const` for field options
5. Use field type guards for runtime type checking

### Organization

1. Keep collections in separate files
2. Extract access control to `access/` directory
3. Extract hooks to `hooks/` directory
4. Use reusable field factories for common patterns
5. Document complex access control with comments

## Common Gotchas

1. **Local API Default**: Access control bypassed unless `overrideAccess: false`
2. **Transaction Safety**: Missing `req` in nested operations breaks atomicity
3. **Hook Loops**: Operations in hooks can trigger the same hooks
4. **Field Access**: Cannot use query constraints, only boolean
5. **Relationship Depth**: Default depth is 2, set to 0 for IDs only
6. **Draft Status**: `_status` field auto-injected when drafts enabled
7. **Type Generation**: Types not updated until `generate:types` runs
8. **MongoDB Transactions**: Require replica set configuration
9. **SQLite Transactions**: Disabled by default, enable with `transactionOptions: {}`
10. **Point Fields**: Not supported in SQLite

## Additional Context Files

For deeper exploration of specific topics, refer to the context files located in `.cursor/rules/`:

### Available Context Files

1. **`payload-overview.md`** - High-level architecture and core concepts

   - Payload structure and initialization
   - Configuration fundamentals
   - Database adapters overview

2. **`security-critical.md`** - Critical security patterns (⚠️ IMPORTANT)

   - Local API access control
   - Transaction safety in hooks
   - Preventing infinite hook loops

3. **`collections.md`** - Collection configurations

   - Basic collection patterns
   - Auth collections with RBAC
   - Upload collections
   - Drafts and versioning
   - Globals

4. **`fields.md`** - Field types and patterns

   - All field types with examples
   - Conditional fields
   - Virtual fields
   - Field validation
   - Common field patterns

5. **`field-type-guards.md`** - TypeScript field type utilities

   - Field type checking utilities
   - Safe type narrowing
   - Runtime field validation

6. **`access-control.md`** - Permission patterns

   - Collection-level access
   - Field-level access
   - Row-level security
   - RBAC patterns
   - Multi-tenant access control

7. **`access-control-advanced.md`** - Complex access patterns

   - Nested document access
   - Cross-collection permissions
   - Dynamic role hierarchies
   - Performance optimization

8. **`hooks.md`** - Lifecycle hooks

   - Collection hooks
   - Field hooks
   - Hook context patterns
   - Common hook recipes

9. **`queries.md`** - Database operations

   - Local API usage
   - Query operators
   - Complex queries with AND/OR
   - Performance optimization

10. **`endpoints.md`** - Custom API endpoints

    - REST endpoint patterns
    - Authentication in endpoints
    - Error handling
    - Route parameters

11. **`adapters.md`** - Database and storage adapters

    - MongoDB, PostgreSQL, SQLite patterns
    - Storage adapter usage (S3, Azure, GCS, etc.)
    - Custom adapter development

12. **`plugin-development.md`** - Creating plugins

    - Plugin architecture
    - Modifying configuration
    - Plugin hooks
    - Best practices

13. **`components.md`** - Custom Components

    - Component types (Root, Collection, Global, Field)
    - Server vs Client Components
    - Component paths and definition
    - Default and custom props
    - Using hooks
    - Performance best practices
    - Styling components

## Frontend Architecture

The consumer-facing frontend is a mobile-first PWA built alongside the Payload CMS admin in the same Next.js 15 app.

### Tech Stack

- **Tailwind CSS v4** — configured via `@tailwindcss/postcss`, no `tailwind.config.ts`; all theme config lives in `globals.css` using `@theme inline` and CSS custom properties
- **shadcn/ui** — components in `src/components/ui/`, new-york style, neutral base with AnySkin brand colors
- **Drizzle ORM** — frontend queries use `payload.db.drizzle` (NodePgDatabase) and `payload.db.tables` (Record<string, PgTableWithColumns<any>>) directly, NOT Payload's Local API
- **lucide-react** — icon library (installed by shadcn)
- **zxing-wasm** — barcode detection fallback for browsers without native BarcodeDetector

### AnySkin Brand Colors (oklch in globals.css)

| Role | Color | Usage |
|------|-------|-------|
| Primary | `#7436d9` (purple) | Buttons, active tab, scan button |
| Accent | `#ff8327` (orange) | Accent highlights |
| Foreground | `#262340` (dark navy) | Text |
| Ring | `#bfbefc` (lavender) | Focus rings |
| theme-color | `#fbfafd` | iOS/Android status bar |

### Route Structure

```
src/app/(frontend)/
├── layout.tsx              # Root: html/body, globals.css, viewport meta, PWA meta
├── page.tsx                # Redirects to /discover
├── globals.css             # Tailwind theme, brand colors, standalone PWA overrides
└── (tabs)/                 # Route group — all pages with bottom nav
    ├── layout.tsx          # App shell: header (burger|logo|profile) + bottom nav
    ├── discover/page.tsx   # Top-rated products by category, horizontal scroll carousels with score pills
    ├── videos/page.tsx     # Recent videos with thumbnails, creators, mentions
    ├── products/
    │   ├── page.tsx        # Product search — responsive grid of ProductCards with score pills
    │   └── [gtin]/
    │       ├── page.tsx    # Product detail (by GTIN, not numeric ID)
    │       └── not-found.tsx  # Product 404 with feedback form
    ├── lists/
    │   ├── page.tsx        # Product type index (links to per-type rankings)
    │   └── [slug]/page.tsx # Per-type ranked product list
    └── profile/page.tsx    # Placeholder (future: saved products, preferences)
```

### Shared Components

| Component | Path | Type | Purpose |
|-----------|------|------|---------|
| `AnySkinLogo` | `components/anyskin-logo.tsx` | Server | Inline SVG wordmark, reusable |
| `BottomNav` | `components/bottom-nav.tsx` | Client | 5-tab fixed bottom nav with scanner integration |
| `AppHeader` | `components/app-header.tsx` | Client | Top bar: burger menu on tab roots, back button on sub-pages |
| `AppDrawer` | `components/app-drawer.tsx` | Client | Slide-from-left burger menu (shadcn Sheet) |
| `BarcodeScanner` | `components/barcode-scanner.tsx` | Client | Full-screen camera overlay with viewfinder |
| `ProductCard` | `components/product-card.tsx` | Server | Reusable product card with image, name, brand, and compact tier-colored score pills (store + creator). Width controlled by caller via `className` prop (e.g. `w-40 shrink-0 snap-start` for carousels, or grid-auto in responsive grids). Props: `gtin`, `name`, `brandName`, `productTypeName?`, `creatorScore?` (0–10), `storeScore?` (0–10), `imageUrl?`, `className?`. Contains internal `ScorePill` component: tiny tier-colored badge with icon + score + label. Empty creator state shows gray "No reviews" pill. |
| `ProductSearch` | `components/product-search.tsx` | Client | Search input with clear button, GTIN detection |
| `ChannelFilter` | `components/channel-filter.tsx` | Client | Horizontally scrollable channel chips with avatars for video filtering |
| `StoreLogo` | `components/store-logos.tsx` | Server | DM, Rossmann, Müller inline SVG logos (`<StoreLogo source="dm" />`), aspect-ratio-aware sizing |
| `Sparkline` | `components/sparkline.tsx` | Server | Tiny SVG sparkline (no axes/labels), green if price dropped, red if rose. Props: `data` (chronological numbers), `width`, `height` |
| `ProductVideoList` | `components/product-video-list.tsx` | Client | Paginated video mention cards with sentiment badge overlay on thumbnail, creator avatar, timestamp, and all quotes rendered as stacked sentiment-colored strips. Links include `?sceneId=X` to deep-link into video detail. Props: `videos: ProductVideoItem[]`. Exports `ProductVideoItem`, `ProductVideoQuote` types. |
| `AccordionSection` | `components/accordion-section.tsx` | Client | Collapsible section with title/trailing/chevron, uses Radix Collapsible. Props: `title`, `trailing`, `defaultOpen`, `children`. Multiple can be open simultaneously. |
| `DescriptionTeaser` | `components/description-teaser.tsx` | Client | Truncated product description (~100 chars) with a "more" link that opens a bottom-sheet (Sheet) displaying the full text. Used in the product detail hero header. Props: `description: string`. |
| `IngredientChipGroup` | `components/ingredient-chip-group.tsx` | Client | Tappable ingredient pills (amber for restricted, neutral for others). Opens bottom-sheet listing all ingredients as collapsible rows (one open at a time). Each row shows index, name, functions, and expands to show description, function pills, CAS number, and restriction warnings. Optimized for 50+ items. Props: `items: IngredientItem[]`. Exports `IngredientItem` type. |
| `TraitChipGroup` | `components/trait-chip.tsx` | Client | Renders attribute/claim pills; tapping any chip opens a bottom-sheet (Sheet) listing ALL traits as collapsible rows, with the tapped one pre-expanded. Each row shows evidence in a blocky quote-style card: left-bordered quote block with ingredient pills or snippet text, plus store logo + name attribution below. Props: `items: TraitItem[]`. Exports `TraitItem`, `TraitEvidence` types. |
| `CreatorScoreCard` | `components/score-sheet.tsx` | Client | Tappable creator score badge (sentiment color + creator avatars). Opens bottom-sheet listing all creators with avatar, name, mention count, individual sentiment score, and per-channel platform links (YouTube/Instagram/TikTok pills with platform icons). Props: `avgSentiment`, `dominantSentiment`, `totalMentions`, `creators: CreatorScoreItem[]`. Exports `CreatorScoreItem`, `CreatorChannel` types. |
| `StoreScoreCard` | `components/score-sheet.tsx` | Client | Tappable store score badge (amber + store logos). Opens bottom-sheet listing all stores as white cards (`bg-card`) with logo, name, review count, star rating, and a `ScoreBadge` on the right. Props: `avgStoreRating`, `stores: StoreScoreItem[]`. |
| `ScoreBadge` | `components/score-sheet.tsx` | Server | Small rounded badge showing a star icon + numeric score (0-10), colored by tier (emerald/lime/amber/rose). Used inside store cards on both the product detail page and the StoreScoreCard bottom-sheet. Props: `score: number`. |
| `VideoDetailClient` | `components/video-detail-client.tsx` | Client | Full video detail page with YouTube IFrame API player, seekable timestamps, collapsible scene blocks with product tiles, sentiment indicators, and quote cards. Supports `initialSceneId` prop to auto-open a specific scene and seek to its timestamp on load (used when deep-linking from product pages). Exports `VideoMentionItem`, `VideoQuote`, `VideoDetailClientProps` types. |

### Score Tier System

`lib/score-utils.tsx` is the **single source of truth** for the rating tier system. It is a plain (non-`'use client'`) file so it can be imported by both server and client components. It exports:

- `ScoreTier` type — `'low' | 'mid' | 'good' | 'great' | 'gold'`
- `scoreTier(score, opts?)` — maps 0–10 score to a tier (≥7.5 great, ≥5 good, ≥3 mid, else low). Pass `{ gold: true }` to enable the gold shimmer tier for scores ≥9 (only used for creator scores).
- `starsToScore10(stars: number)` — converts 0–5 star rating to 0–10 scale
- `storeLabel(slug: string | null)` — maps source slug to display name (dm→"dm", rossmann→"Rossmann", mueller→"Müller")
- Color maps: `tierTextColor`, `tierCardBg`, `tierBadgeBg`, `tierDivider` — keyed by `ScoreTier`
- `ScoreBadge` component — small rounded badge with star icon + tier-colored score number

`components/score-sheet.tsx` (`'use client'`) re-exports everything from `score-utils` for backward compatibility, plus provides the interactive sheet components (`CreatorScoreCard`, `StoreScoreCard`).

Server components (e.g. `products/[gtin]/page.tsx`) import directly from `@/lib/score-utils`. Client components can import from either location.

### Layout & Navigation

- **Header** (`AppHeader`): Left slot | Centered logo | Profile icon (right). On tab root paths (`/discover`, `/videos`, `/products`, `/lists`, `/profile`) the left slot shows the burger menu (`AppDrawer`). On sub-pages (e.g. `/products/[gtin]`, `/lists/[slug]`) it shows a back button (`ChevronLeft`, `router.back()`). Solid `bg-background`, no transparency. Respects `env(safe-area-inset-top)` for iOS status bar.
- **Bottom nav**: 5 tabs — Discover, Videos, **Scan** (center, elevated), Search, Top Lists. Fixed to bottom with `env(safe-area-inset-bottom)` spacer.
- **Scan button**: Elevated 64px primary-colored circle, opens `BarcodeScanner` overlay from any tab (no route change).
- **No page titles on tab pages** — the active tab in the bottom nav indicates location. Sub-pages (e.g. `/lists/[slug]`, `/products/[gtin]`) do have titles.
- **Drawer menu**: Contains legal links (Imprint, Terms, Data Protection) and tagline.

### Mobile-First Design Preferences

- **App-like feel** is the top priority
- Cards on mobile, tables on desktop (`md:` breakpoint)
- `100dvh` not `100vh` (dynamic viewport height for mobile browser chrome)
- `touch-action: manipulation` on body (disables pinch-zoom, double-tap-zoom)
- `overscroll-none`, `select-none` on body (re-enabled on `<main>` for content)
- `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none`
- `viewport-fit=cover`, `maximum-scale=1, user-scalable=no`
- `apple-mobile-web-app-capable: yes` for iOS standalone mode
- Standalone PWA gets extra bottom padding via `@media (display-mode: standalone)` with `!important` to override Tailwind utilities

### Horizontal Scroll Sections Pattern

Used on Discover page for product carousels:

```tsx
{/* Outer: overflow + edge-to-edge bleed */}
<div className="overflow-x-auto -mx-4 snap-x snap-mandatory scroll-pl-4 scrollbar-none">
  {/* Inner: inline-flex so px-4 padding is preserved on both sides */}
  <div className="inline-flex gap-3 px-4 pb-1">
    <ProductCard ... />
  </div>
</div>
```

Key details:
- Outer div: `overflow-x-auto -mx-4` bleeds to screen edge, `snap-x snap-mandatory` for snap, `scroll-pl-4` so snap respects the padding
- Inner div: **`inline-flex`** (not `flex`) — this is critical; `flex` would stretch to parent width and right padding gets consumed by overflow. `inline-flex` sizes to content so `px-4` is preserved on both ends.
- `.scrollbar-none` hides scrollbar (defined in globals.css)
- Cards use `snap-start shrink-0 w-40`

### Direct Database Access

You can connect directly to PostgreSQL to inspect schema, verify column names, or test raw SQL queries. The connection string is in `server/.env`:

```bash
# Read the DATABASE_URL from server/.env
psql "postgres://anyskin_crawler_dev:anyskin_crawler_dev@localhost:5432/anyskin_crawler_dev"

# Useful commands:
\dt                    # list all tables
\d <table_name>        # show columns, types, indexes, FKs for a table
\d+ <table_name>       # same with storage info
\dT+ <enum_name>       # show enum values (e.g. \dT+ enum_source_products_source)
```

Always verify column names against the actual database before writing raw SQL (`db.execute(sql\`...\`)`). Migrations in `server/src/migrations/` are the source of truth for schema — the project uses migration-based schema management (`push: false`), not `payload db push`.

### PostgreSQL Column Naming Convention

Payload CMS 3.x with `@payloadcms/db-postgres` converts all field names to **snake_case** in PostgreSQL. This affects raw SQL queries. Drizzle ORM handles the mapping automatically.

#### Rules

| Payload field type | Payload field name | PostgreSQL column name | Example |
|---|---|---|---|
| Simple field | `name` | `name` | `name` → `name` |
| camelCase field | `ratingNum` | `rating_num` | `ratingNum` → `rating_num` |
| Relationship (singular) | `brand` | `brand_id` | `brand` → `brand_id` |
| Relationship (singular) | `sourceProduct` | `source_product_id` | `sourceProduct` → `source_product_id` |
| Relationship (singular) | `productType` | `product_type_id` | `productType` → `product_type_id` |
| Upload field | `image` | `image_id` | `image` → `image_id` |
| Date field | `claimedAt` | `claimed_at` | `claimedAt` → `claimed_at` |
| Boolean field | `crawlVariants` | `crawl_variants` | `crawlVariants` → `crawl_variants` |
| Array field | `images` | **separate table** | `products.images` → `products_images` table |
| hasMany select | `capabilities` | **separate table** | `workers.capabilities` → `workers_capabilities` table |

#### Key patterns

- **Relationship FKs** always get `_id` suffix: `brand` → `brand_id`, `sourceProduct` → `source_product_id`, `claimedBy` → `claimed_by_id`
- **Upload FKs** same pattern: `image` → `image_id`
- **Array fields** create a sub-table: `{collection}_{field}` (e.g. `products_images`, `source_variants_price_history`) with `_parent_id` (FK back to parent), `_order` (integer), and the array item's own fields
- **hasMany select fields** create a sub-table: `{collection}_{field}` (e.g. `workers_capabilities`) with `parent_id`, `value` (the enum value), `order`
- **hasMany relationships** create a `{collection}_rels` join table (e.g. `products_rels`, `events_rels`) with FK columns named `{related_collection_snake}_id` (e.g. `source_products_id`, `product_crawls_id`)
- **Enum types** are named `enum_{table}_{column}` (e.g. `enum_source_products_source`). Each table gets its own enum even if the values are identical (e.g. `status` columns) — this means `UNION` across tables with enum columns requires `::text` casts
- **Timestamps** auto-added: `updated_at`, `created_at` (snake_case)

#### Quick reference: commonly used columns

| Table | Payload field | DB column |
|---|---|---|
| `products` | `brand` | `brand_id` |
| `products` | `productType` | `product_type_id` |
| `products` | `images` (array) | `products_images` table (no `image` column on products) |
| `products` | `description` | `description` |
| `source_products` | `ratingNum` | `rating_num` |
| `source_products` | `sourceUrl` | `source_url` |
| `source_products` | `brandName` | `brand_name` |
| `source_products` | `categoryBreadcrumb` | `category_breadcrumb` |
| `source_variants` | `sourceProduct` | `source_product_id` |
| `source_variants` | `sourceUrl` | `source_url` |
| `source_variants` | `ingredientsText` | `ingredients_text` |
| `source_variants` | `amountUnit` | `amount_unit` |
| `source_variants` | `crawledAt` | `crawled_at` |
| `source_variants` | `sourceArticleNumber` | `source_article_number` |
| `videos` | `channel` | `channel_id` |
| `video_scenes` | `timestampStart` | `timestamp_start` |
| `video_scenes` | `video` | `video_id` |
| `video_mentions` | `overallSentiment` | `overall_sentiment` |
| `video_mentions` | `overallSentimentScore` | `overall_sentiment_score` |
| `video_mentions` | `confidence` | `confidence` |
| `video_mentions` | `barcodeValue` | `barcode_value` |
| `video_mentions` | `clipDistance` | `clip_distance` |
| `video_mentions` | `product` | `product_id` |
| `video_mentions` | `videoScene` | `video_scene_id` |
| `channels` | `creator` | `creator_id` |
| `channels` | `canonicalUrl` | `canonical_url` |
| `workers` | `lastSeenAt` | `last_seen_at` |
| `workers` | `enableAPIKey` | `enable_a_p_i_key` |
| Job tables | `claimedBy` | `claimed_by_id` |
| Job tables | `claimedAt` | `claimed_at` |
| Job tables | `retryCount` | `retry_count` |
| Job tables | `maxRetries` | `max_retries` |
| Job tables | `failedAt` | `failed_at` |
| Job tables | `failureReason` | `failure_reason` |
| Job tables | `startedAt` | `started_at` |
| Job tables | `completedAt` | `completed_at` |
| Job tables | `itemsPerTick` | `items_per_tick` |
| `product_crawls` | `crawlVariants` | `crawl_variants` |
| `product_crawls` | `minCrawlAge` | `min_crawl_age` |
| `product_crawls` | `discovery` | `discovery_id` |

### Drizzle ORM Query Patterns

**IMPORTANT: Column naming differs between Drizzle ORM and raw SQL.** See the "PostgreSQL Column Naming Convention" section above for the full reference. Summary:

- **Drizzle ORM** (`t.products.brand`, `eq(t.source_variants.sourceProduct, ...)`) — use **camelCase Payload field names**. Drizzle maps them to actual DB columns automatically.
- **Raw SQL** (`db.execute(sql\`...\`)`) — use **actual snake_case DB column names** (`brand_id`, `source_product_id`). Never use camelCase in raw SQL.

```typescript
const payload = await getPayload({ config: await config })
const db = payload.db.drizzle
const t = payload.db.tables  // e.g. t.products, t.brands, t.source_products, t.source_variants

// Table names are snake_case: products, brands, product_types, product_variants, source_products, source_variants
// Drizzle property names are camelCase: t.source_products.ratingNum → actual DB column: rating_num
// Payload array fields → separate tables: products_ingredients, products_product_claims
// hasMany relationships → {collection}_rels join table (e.g. products_rels)
// product_variants has: product (FK → products), gtin (unique), label, images (→ product_variants_images sub-table with image FK → product_media)
// source_variants has: sourceProduct (FK → source_products), sourceUrl (unique), gtin, variantLabel, variantDimension
// GTINs live on product_variants (unified) and source_variants (per-retailer), NOT on products or source_products
//
// To join products → source_products (for ratings, etc.), go through product_variants + source_variants:
//   .innerJoin(t.product_variants, eq(t.product_variants.product, t.products.id))
//   .innerJoin(t.source_variants, eq(t.source_variants.gtin, t.product_variants.gtin))
//   .innerJoin(t.source_products, eq(t.source_variants.sourceProduct, t.source_products.id))
// Use leftJoin instead of innerJoin when products without source data should still appear.
// When listing products (one row per product), use min(gtin) in select + GROUP BY product.id to deduplicate.

// Image sizes are flattened DB columns on each media table:
// sizes_thumbnail_url, sizes_card_url, sizes_detail_url — access via sql template:
//   sql`coalesce(${t.product_media}.sizes_card_url, ${t.product_media}.url)`
// Join product images: .leftJoin(t.product_variants_images, ...).leftJoin(t.product_media, eq(t.product_variants_images.image, t.product_media.id))
// Join video thumbnails: .leftJoin(t.video_media, eq(t.videos.thumbnail, t.video_media.id))
// Join channel avatars: .leftJoin(t.profile_media, eq(t.channels.image, t.profile_media.id))

// Raw SQL example (use snake_case column names, NOT camelCase):
// db.execute(sql`SELECT source_product_id, rating_num FROM source_products WHERE rating_num > 0`)
// NOT: sql`SELECT "sourceProduct", "ratingNum" FROM source_products` ← WRONG, will fail
```

### Media Image Sizes

Four specialized media collections replace the old single `media` collection:

**`product-media`** — Product variant images:

| Size | Dimensions | Fit | Used For |
|------|-----------|-----|----------|
| `thumbnail` | 96x96 | inside (no enlarge) | List items (search, ranked lists) |
| `card` | 320x240 | inside (no enlarge) | ProductCard carousels (160px CSS @ 2x) |
| `detail` | 780x780 | inside (no enlarge) | Product detail page hero image |

**`video-media`** — Video files (MP4), thumbnails, screenshots:

| Size | Dimensions | Fit | Used For |
|------|-----------|-----|----------|
| `thumbnail` | 96x96 | inside (no enlarge) | Video list thumbnails |
| `card` | 320x240 | inside (no enlarge) | Video cards |
| `detail` | 780x780 | inside (no enlarge) | Video detail page |

**`profile-media`** — Channel avatars, creator images, ingredient images:

| Size | Dimensions | Fit | Used For |
|------|-----------|-----|----------|
| `avatar` | 128x128 | inside (no enlarge) | Channel/creator avatars |
| `thumbnail` | 96x96 | inside (no enlarge) | List items |
| `card` | 320x240 | inside (no enlarge) | Cards |

**`detection-media`** — Grounding DINO detection crops (no image sizes, raw crops only).

All sizes use `fit: 'inside'` to preserve the full image (no cropping). Frontend uses `object-contain` + inner padding on containers so the image is fully visible with breathing room. All pages use `coalesce(sized_url, original_url)` so the original image is used as fallback when no sized variant exists (e.g. non-image media or pre-existing uploads).

### Product Detail Pages

- URL param is **GTIN** (not numeric ID): `/products/[gtin]`
- `notFound()` triggers the custom `not-found.tsx` which explains AnySkin only covers cosmetics and offers a feedback form
- **Sections** (top to bottom): Hero (image + name + brand + **description teaser** + pills + **tappable score badges**), then accordion sections via `<AccordionSection>` (Radix Collapsible-based, multiple can be open): Videos (open, unified paginated list via `ProductVideoList` — each card shows thumbnail with sentiment overlay + duration, title, creator avatar, timestamp, and optional featured quote strip; links to `/videos/{id}?sceneId={sceneId}` for deep-linking), Prices & Stores (open, grid cards with sparkline), Ingredients (closed by default). Description is shown as a truncated teaser in the hero header via `DescriptionTeaser` component; tapping "more" opens a bottom-sheet with the full text.
- **Sentiment scoring**: Per-mention score is -1 to +1. Overall sentiment displayed as a tappable `CreatorScoreCard` badge in the hero section; tapping opens a bottom-sheet listing all creators with individual scores.
- **Store scoring**: Weighted average of store ratings displayed as a tappable `StoreScoreCard` badge in the hero section; tapping opens a bottom-sheet listing all stores with individual star ratings and review counts.
- **Store logos**: `StoreLogo` component renders inline SVG for dm/rossmann/mueller based on `source` slug. DM uses `h-8`, Rossmann `h-6` (wide aspect ~6.25:1), Müller `h-7`. Also stored in worker driver `logoSvg` field.
- **Store cards**: White (`bg-card`) cards with logo on left in a `bg-muted/40` box, price + per-unit + rating + sparkline in the middle, and a `ScoreBadge` (tier-colored score out of 10) on the right. External link icon. Grid: 1 col mobile, 2 cols sm, 3 cols lg.
- **Price history**: Fetched from `source_products_price_history` table, grouped by source product, shows latest price with delta vs previous. **Sparkline** graph shows last 12 months (chronological, oldest→newest) using `<Sparkline />` component (green if price dropped, red if rose).
- **Videos section**: Unified paginated list of all video mentions via `ProductVideoList`. Each card shows thumbnail with sentiment icon overlay + duration badge, title, creator avatar, timestamp at mention, and an optional featured quote strip (the quote with the highest absolute sentiment score for that mention). Clicking a card navigates to `/videos/{id}?sceneId={sceneId}`, which deep-links into the video detail page with that scene auto-opened and its timestamp seeked.

### CSS Specificity with Tailwind v4

Tailwind v4 utilities live in `@layer utilities`. Custom CSS outside a layer has lower specificity. When overriding Tailwind classes conditionally (e.g. in media queries), use `!important`:

```css
@media (display-mode: standalone) {
  .standalone-bottom-pad {
    padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px) + 1.5rem) !important;
  }
}
```

## Shared Package (`@anyskin/shared`)

The server depends on `@anyskin/shared` (workspace package at `../shared/`), consumed as raw TypeScript via `transpilePackages: ['@anyskin/shared']` in `next.config.mjs`. This package provides:

- **`EventRegistry`** — TypeScript interface mapping ~90 typed event names to their data shapes
- **`EVENT_META`** — default type/level/labels for each event name
- **Shared types** — `SourceSlug`, `JobCollection`, `EventType`, `LogLevel`, `EventName`, `EventMeta`, `IngredientField`
- **Ingredient field constants** — `INGREDIENT_FIELDS` (all content field names), `COSING_FIELDS` (fields from CosIng), `INCIDECODER_FIELDS` (fields from INCIDecoder). Used by the Ingredients collection config for the `fieldsProvided` select options, and by worker persist/submit code to set `fieldsProvided` on source entries.

The server's **Events collection** has a `name` field (text, indexed, optional) that stores the typed event name (e.g. `crawl.started`, `persist.price_changed`). This field is populated by the worker's `jlog.event()` method. Old events created via `jlog.info(..., { event: true })` don't have a `name` — they only have the freeform `message` field.

## Admin Dashboard

The admin dashboard uses Payload's experimental `admin.dashboard` feature with 13 custom widget types and a shared data provider. Widgets are split into two categories: **event-driven** (time-scoped activity from the `events` table) and **snapshot** (current database state, not time-scoped).

### Architecture

- **Events endpoint**: `GET /api/dashboard/events?range=1h|24h|7d|30d` (`src/endpoints/dashboard-events.ts`) — runs 9 parallel SQL queries via Drizzle raw SQL, returns aggregated event data including ingredient stats. Auth via `req.user`. Default range: `1h`.
- **Snapshot endpoint**: `GET /api/dashboard/snapshot` (`src/endpoints/dashboard-snapshot.ts`) — runs 13 parallel SQL queries against data tables (products, source-products, source-variants, videos, galleries, etc.). Returns entity counts, data quality metrics, source coverage, video pipeline stats, gallery pipeline stats, job queue status, and active workers. Not time-scoped. Auth via `req.user`.
- **DashboardProvider**: `src/components/dashboard/DashboardProvider.tsx` — `'use client'` component rendered via `beforeDashboard`. Fetches from both endpoints, polls every 30s, provides a range selector UI (4 tabs: 1h/24h/7d/30d) and a "last updated" indicator. Writes data into a module-level pub/sub store.
- **Dashboard store**: `src/components/dashboard/dashboard-store.ts` — module-level pub/sub (same pattern as `BulkJobBar.tsx`'s `getJobState`/`setJobState`). State holds both `data` (DashboardResponse) and `snapshot` (SnapshotResponse). Exports `useDashboardState()` hook via `useSyncExternalStore`. Widget client components subscribe to this store.
- **Widgets**: 13 pairs of server shell + client component, registered in `payload.config.ts` under `admin.dashboard.widgets`. Each server shell just renders its client component.

### DashboardResponse Type (events endpoint)

```typescript
interface DashboardResponse {
  range: '1h' | '24h' | '7d' | '30d'
  since: string
  generatedAt: string
  summary: { totalEvents, errors, warnings, jobsStarted, jobsCompleted, jobsFailed }
  timeline: Array<{ bucket, total, errors, warnings }>
  byDomain: Array<{ domain, total, errors, warnings }>
  bySource: Array<{ source, total, errors }>
  byJobCollection: Array<{ collection, started, completed, failed, retrying }>
  recentErrors: Array<{ id, name, message, data, jobCollection, jobId, createdAt }>  // limit 10
  highlights: {
    productsCrawled, productsDiscovered, productsAggregated, productsSearched,
    ingredientsCrawled, ingredientsDiscovered, videosCrawled, videosProcessed, videosDiscovered,
    galleriesDiscovered, galleriesCrawled, galleriesProcessed,
    priceChanges, priceDrops, priceIncreases, variantsDisappeared, botChecks,
    tokensUsed, avgBatchDurationMs
  }
  ingredientStats: { total, crawled, uncrawled, sourceGroups: Array<{ sourceCount, ingredients }> }
}
```

### SnapshotResponse Type (snapshot endpoint)

```typescript
interface SnapshotResponse {
  generatedAt: string
  entities: {
    products, productVariants, sourceProducts, sourceVariants, uniqueGtins,
    brands, ingredients, videos, creators, channels, mediaFiles
  }
  productQuality: {
    total, withImage, withBrand, withProductType, withIngredients,
    withDescription, withScoreHistory
  }
  sourceCoverage: Array<{
    source, total, crawled, uncrawled, withGtin, variants, avgRating, avgRatingCount
  }>
  galleryPipeline: {
    total, crawled, processed, totalItems, totalMentions
  }
  videoPipeline: {
    total, crawled, processed, unprocessed, withTranscript, totalScenes,
    // Uses status field: "processed" = status='processed', "crawled" = status='crawled', "unprocessed" = status != 'processed'
    // withTranscript uses a subquery against video_scenes (videos with at least one scene that has a transcript), not a column on videos
    totalScenes, totalMentions,
    mentionsByPositive, mentionsByNeutral, mentionsByNegative, mentionsByMixed,
    productsWithMentions, channelsByPlatform: Array<{ platform, count }>
  }
  jobQueue: Array<{
    collection, pending, inProgress, completed, failed, active, stale
  }>
  workers: Array<{ id, name, status, lastSeenAt, capabilities }>
}
```

### Widget Types

#### Event-driven widgets (time-scoped, from `DashboardResponse`)

| Widget | Slug | Client Component | Description |
|--------|------|-----------------|-------------|
| EventSummary | `event-summary` | `EventSummaryClient` | 6 stat cards (total, errors, warnings, jobs started/completed/failed) |
| EventTimeline | `event-timeline` | `EventTimelineClient` | recharts stacked BarChart (Info/Warnings/Errors over time) |
| EventDomains | `event-domains` | `EventDomainsClient` | recharts horizontal BarChart with per-domain colors |
| EventSources | `event-sources` | `EventSourcesClient` | CSS bar chart with store names and colors |
| EventJobs | `event-jobs` | `EventJobsClient` | Table with started/completed/failed/retrying per job collection, clickable links to collection list views |
| EventHighlights | `event-highlights` | `EventHighlightsClient` | Dynamic grid of metric cards: crawled, discovered, aggregated, searched, ingredients, videos, price changes (with drop/increase breakdown), disappeared variants, bot checks, tokens used, avg batch duration. Only non-zero metrics are shown. |
| EventErrors | `event-errors` | `EventErrorsClient` | Last 10 errors with event name, clickable job links (to admin edit view), time ago, and extracted key data fields (url, source, ingredient, etc.) from the error's JSON data |
| IngredientStats | `ingredient-stats` | `IngredientStatsClient` | Total/crawled/uncrawled counts with progress bar, source coverage breakdown (0/1/2+ sources). Not time-scoped. |

#### Snapshot widgets (not time-scoped, from `SnapshotResponse`)

| Widget | Slug | Client Component | Description |
|--------|------|-----------------|-------------|
| DatabaseOverview | `database-overview` | `DatabaseOverviewClient` | Grid of 11 entity count cards (products, variants, GTINs, source products/variants, brands, ingredients, videos, creators, channels, media) |
| ProductQuality | `product-quality` | `ProductQualityClient` | Overall completeness percentage + 6 horizontal progress bars (image, brand, productType, ingredients, description, scoreHistory) |
| SourceCoverage | `source-coverage` | `SourceCoverageClient` | Table with one row per store: products count, crawl progress bar with %, variants, GTINs, avg rating with review count |
| VideoPipeline | `video-pipeline` | `VideoPipelineClient` | Pipeline progress bar (discovered/crawled/processed via status field), stats grid (scenes, mentions, products, transcripts), sentiment breakdown, channels by platform |
| JobQueue | `job-queue` | `JobQueueClient` | Live workers section (name, status dot, last seen) + job queue table (pending/running/completed/failed/stale per collection, clickable links) |

### Key Files

- `src/endpoints/dashboard-events.ts` — events endpoint handler (9 SQL queries, time-scoped)
- `src/endpoints/dashboard-snapshot.ts` — snapshot endpoint handler (12 SQL queries, current state)
- `src/components/dashboard/dashboard-store.ts` — pub/sub store (holds both `data` and `snapshot`)
- `src/components/dashboard/DashboardProvider.tsx` — data fetcher + range selector + last-updated indicator
- `src/components/dashboard/widgets/Event*.tsx` — event widget server shells
- `src/components/dashboard/widgets/Event*Client.tsx` — event widget client components
- `src/components/dashboard/widgets/IngredientStats.tsx` / `IngredientStatsClient.tsx`
- `src/components/dashboard/widgets/DatabaseOverview.tsx` / `DatabaseOverviewClient.tsx`
- `src/components/dashboard/widgets/ProductQuality.tsx` / `ProductQualityClient.tsx`
- `src/components/dashboard/widgets/SourceCoverage.tsx` / `SourceCoverageClient.tsx`
- `src/components/dashboard/widgets/VideoPipeline.tsx` / `VideoPipelineClient.tsx`
- `src/components/dashboard/widgets/JobQueue.tsx` / `JobQueueClient.tsx`

### Styling Notes

- **Payload admin panel does not load Tailwind CSS** — all dashboard components use inline styles and Payload CSS variables (`var(--theme-elevation-...)`, `var(--theme-text)`, etc.)
- Charts use `recharts` (installed as server dependency)
- Widget widths: `x-small` = 25%, `small` = 33.33%, `medium` = 50%, `large` = 66.67%, `x-large` = 75%, `full` = 100%

### Extending the Dashboard — Checklist

The dashboard endpoint (`src/endpoints/dashboard-events.ts`) aggregates events using **hardcoded event names in raw SQL**. There are no shared constants — every event name reference is inline. When adding a new job type, new events, or new highlights, you must update multiple places. This checklist covers every location.

#### Scenario A: Adding a new job type (new job collection + handler)

When a new job collection is added (e.g. `ingredient-enrichments`), the dashboard has **5 update sites**:

1. **Events collection `job` field** — `src/collections/Events.ts:79`
   - Add the new collection slug to the `relationTo` array on the `job` polymorphic relationship field:
   ```typescript
   relationTo: ['product-discoveries', ..., 'ingredient-crawls', 'ingredient-enrichments'],
   ```

2. **Query #5 (byJobCollection) — CASE WHEN subquery** — `dashboard-events.ts:213-225`
   - Add a new WHEN clause to the CASE expression that maps the FK column to a slug:
   ```sql
   WHEN ingredient_enrichments_id IS NOT NULL THEN 'ingredient-enrichments'
   ```
   - Add the new FK column to the `coalesce(...)` for `job_id`

3. **Query #6 (recentErrors) — same CASE WHEN subquery** — `dashboard-events.ts:250-262`
   - Identical change as #2 — this is a duplicate of the CASE/coalesce logic for the LEFT JOIN

4. **Query #5 WHERE clause** — `dashboard-events.ts:231-232`
   - No change needed — uses `LIKE '%.completed'` and exact matches for universal events (`job.claimed`, `job.failed`, etc.) which auto-match new job types

5. **Query #1 (summary)** — `dashboard-events.ts:155-157`
   - No change needed — uses same LIKE/IN patterns that auto-match

**Note**: The two CASE WHEN blocks (queries #5 and #6) are duplicated code. If you add a new job collection, you must update **both**. The FK column name is derived from the Payload collection slug with hyphens replaced by underscores (e.g. `ingredient-enrichments` → `ingredient_enrichments_id`).

#### Scenario B: Adding a new domain-specific completion event

When a new job type emits its own `<domain>.completed` event (e.g. `enrichment.completed`):

1. **`shared/src/events.ts`** — Add the event to `EventRegistry` with its data shape, and add default metadata to `EVENT_META`

2. **Query #1 (summary `jobsCompleted`)** — `dashboard-events.ts:156`
   - No change needed — `name LIKE '%.completed'` auto-matches any `<domain>.completed`

3. **Query #5 (byJobCollection `completed`)** — `dashboard-events.ts:207`
   - No change needed — same LIKE pattern

4. **Query #7 (highlights `tokensUsed`)** — `dashboard-events.ts:278-280`
   - **MUST UPDATE** if the new completion event carries `tokensUsed` in its data. Add it to the IN list:
   ```sql
   WHERE name IN ('crawl.completed', 'aggregation.completed', 'video_processing.completed', 'ingredient_crawl.completed', 'enrichment.completed')
   ```
   - Only job-level completion events with `tokensUsed` in their EventRegistry data shape should be listed here

**Known quirk**: The `%.completed` LIKE pattern also matches per-item events like `video_processing.complete` and `classification.complete` (note: `.complete` not `.completed`). These are per-item events, not job-level completions. This slightly inflates `jobsCompleted` counts. The naming convention is: **job-level completions use `.completed`** (past tense), **per-item completions use `.complete`** (present tense). New events should follow this convention.

#### Scenario C: Adding a new highlight metric

To add a new metric to the Highlights widget (e.g. "Ingredients Crawled"):

1. **`DashboardResponse` type** — `dashboard-events.ts:63-70`
   - Add the new field to `highlights`

2. **Query #7 (highlights)** — `dashboard-events.ts:272-284`
   - Add a new `coalesce(sum/count/avg(...) FILTER (WHERE name = '...'), 0)::int AS "newMetric"` line

3. **Response shaping** — `dashboard-events.ts:373-380`
   - Add the new field to the highlights object

4. **Widget** — `src/components/dashboard/widgets/EventHighlightsClient.tsx`
   - Add a new `<Metric>` card

#### Scenario D: Adding a new batch event for avg duration

The `avgBatchDurationMs` highlight uses `LIKE '%.batch_done'` — `dashboard-events.ts:281`. This auto-matches any event named `<domain>.batch_done`. If your new job type emits `<domain>.batch_done` with `batchDurationMs` in its data, it's automatically included. No changes needed.

Current matches: `crawl.batch_done`, `video_crawl.batch_done`, `video_processing.batch_done`, `aggregation.batch_done`, `ingredient_crawl.batch_done`.

Events ending in `.batch_persisted` (discovery, search, ingredients_discovery, video_discovery) are **not** matched — they use a different naming convention because they persist discovered items rather than processing batches.

#### Scenario E: Adding a new dashboard widget

1. Create server shell: `src/components/dashboard/widgets/MyWidget.tsx` (imports and renders MyWidgetClient)
2. Create client component: `src/components/dashboard/widgets/MyWidgetClient.tsx` (`'use client'`, uses `useDashboardState()` from `dashboard-store.ts`)
3. Register in `payload.config.ts` under `admin.dashboard.widgets` (slug, label, ComponentPath, minWidth, maxWidth) and `defaultLayout`
4. If the widget needs **event-driven** data: add fields to `DashboardResponse` in `dashboard-events.ts`, add SQL query to the `Promise.all`, shape in the response object. Access via `const { data } = useDashboardState()`
5. If the widget needs **snapshot** data (entity counts, data quality, etc.): add fields to `SnapshotResponse` in `dashboard-snapshot.ts`, add SQL query to the `Promise.all`, shape in the response object. Access via `const { snapshot } = useDashboardState()`
6. Delete `importMap.js` and regenerate: `rm src/app/\(payload\)/admin/importMap.js && pnpm payload generate:importmap`

#### Quick reference: All hardcoded event names in dashboard-events.ts

| Event name / pattern | Query | Purpose |
|---|---|---|
| `job.claimed` | #1, #5 | Job started count |
| `%.completed` (LIKE) | #1, #5 | Job completed count |
| `job.completed_empty` | #1, #5 | Job completed (no work) |
| `job.failed` | #1, #5 | Job failed count |
| `job.failed_max_retries` | #1, #5 | Job failed (max retries) |
| `job.retrying` | #5 | Job retry count |
| `crawl.batch_done` | #7 | Products crawled (batchSuccesses) |
| `discovery.batch_persisted` | #7 | Products discovered (batchPersisted) |
| `aggregation.batch_done` | #7 | Products aggregated |
| `search.batch_persisted` | #7 | Products searched (persisted) |
| `ingredient_crawl.batch_done` | #7 | Ingredients crawled |
| `ingredients_discovery.batch_persisted` | #7 | Ingredients discovered |
| `video_crawl.batch_done` | #7 | Videos crawled (batchSuccesses) |
| `video_processing.batch_done` | #7 | Videos processed |
| `video_discovery.batch_persisted` | #7 | Videos discovered |
| `persist.price_changed` | #7 | Price changes (total, drops, increases) |
| `persist.variants_disappeared` | #7 | Variants disappeared (markedUnavailable) |
| `scraper.bot_check_detected` | #7 | Bot check count |
| `crawl.completed` | #7 | Tokens used (IN list) |
| `aggregation.completed` | #7 | Tokens used (IN list) |
| `video_processing.completed` | #7 | Tokens used (IN list) |
| `ingredient_crawl.completed` | #7 | Tokens used (IN list) |
| `gallery_processing.completed` | #7 | Tokens used (IN list) |
| `gallery_discovery.batch_persisted` | #7 | Galleries discovered (batchPersisted) |
| `gallery_crawl.batch_done` | #7 | Galleries crawled (batchSuccesses) |
| `gallery_processing.batch_done` | #7 | Galleries processed (completed) |
| `%.batch_done` (LIKE) | #7 | Avg batch duration |

#### Quick reference: CASE WHEN FK columns in events_rels (queries #5 and #6)

Both queries #5 (line 213) and #6 (line 250) have identical CASE WHEN subqueries mapping FK columns to collection slugs. Current mappings:

| FK column | Collection slug |
|---|---|
| `product_crawls_id` | `product-crawls` |
| `product_discoveries_id` | `product-discoveries` |
| `product_searches_id` | `product-searches` |
| `ingredients_discoveries_id` | `ingredients-discoveries` |
| `product_aggregations_id` | `product-aggregations` |
| `video_crawls_id` | `video-crawls` |
| `video_discoveries_id` | `video-discoveries` |
| `video_processings_id` | `video-processings` |
| `ingredient_crawls_id` | `ingredient-crawls` |
| `gallery_discoveries_id` | `gallery-discoveries` |
| `gallery_crawls_id` | `gallery-crawls` |
| `gallery_processings_id` | `gallery-processings` |

When adding a new job collection, add a new WHEN clause to **both** CASE blocks and add the new FK column to **both** `coalesce(...)` expressions.

## Embeddings API (pgvector)

Generic API for storing and searching embedding vectors in pgvector columns. The API uses a **namespace** abstraction — each namespace maps to a specific database table and vector column configuration. Adding new embedding targets only requires a new namespace entry + a migration.

### File

`src/endpoints/embeddings.ts` — namespace registry + handlers

### Namespace Registry

```typescript
const NAMESPACES: Record<string, EmbeddingNamespace> = {
  'recognition-images': {
    table: 'recognition_embeddings',
    embeddingColumn: 'embedding',        // vector(768) — manual migration, NOT managed by Payload
    dimensions: 768,                     // DINOv2-small
    idColumn: 'id',
    upsertColumns: ['product_variant_id', 'detection_media_id', 'augmentation_type'],
    returnColumns: ['product_variant_id'],
    join: { table: 'product_variants', on: ['product_variant_id', 'id'], columns: ['gtin'] },
  },
}
```

To add a new embedding target: add a namespace entry + create a migration that adds `embedding vector(N)` and an HNSW index to the target table.

### Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/embeddings/:namespace/write` | `req.user` required | Batch write embedding vectors. Body: `{ items: Array<{ id, embedding: number[] }> }` (plain INSERT/UPDATE by ID) or `{ items: Array<{ upsertValues: Record<string, unknown>, embedding: number[] }> }` (upsert by `upsertColumns` for namespaces that define them). Validates dimensions match namespace config. |
| `POST` | `/api/embeddings/:namespace/delete` | `req.user` required | Delete rows by filter criteria. Body: `{ filter: Record<string, unknown> }` — deletes all rows where columns match the filter values (e.g. `{ product_variant_id: 42 }`). |
| `GET` | `/api/embeddings/:namespace/search` | `req.user` required | Cosine similarity search. Query params: `vector` (JSON array), `limit` (default 10, max 100), `threshold` (max cosine distance, optional). Returns `{ results: Array<{ id, distance, ...returnColumns, ...joinColumns }> }`. Uses pgvector `<=>` operator (cosine distance). |

### Key Details

- **Vector columns are NOT managed by Payload** — they are added via manual migrations (`ALTER TABLE ... ADD COLUMN embedding vector(768)`). Payload ignores them; the embeddings endpoint handles all reads/writes via raw SQL.
- **The `recognition_embeddings` table is standalone** — it is not a Payload array sub-table. Row existence IS the embedding flag; there is no separate boolean column. This decouples embeddings from Payload's array rewrite behavior.
- **Upsert mode**: namespaces with `upsertColumns` use `INSERT ... ON CONFLICT (col1, col2) DO UPDATE SET embedding = EXCLUDED.embedding` instead of UPDATE by row ID.
- **HNSW index** on the vector column for fast approximate nearest neighbor search. Created in the migration.
- **pgvector extension** is enabled via `extensions: ['vector']` on the postgresAdapter in `payload.config.ts`.

## Keeping This File Up to Date

Whenever you make changes to the server codebase, **update this file** to reflect those changes. This includes additions or modifications to collections, fields, hooks, access control, components, actions, endpoints, or any server-side patterns documented here. Documentation must stay in sync with the code.

For changes that affect the overall repository layout or cross both server and worker, also update the root `CLAUDE.md`. See the root file for the full policy.

## Resources

- Docs: https://payloadcms.com/docs
- LLM Context: https://payloadcms.com/llms-full.txt
- GitHub: https://github.com/payloadcms/payload
- Examples: https://github.com/payloadcms/payload/tree/main/examples
- Templates: https://github.com/payloadcms/payload/tree/main/templates
