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

- **Do NOT create database migrations.** The developer handles migrations manually. Only modify collection configs and let the developer run migrations themselves.

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
├── components/                  # Shared React components
│   ├── ui/                      # shadcn/ui primitives
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
│   └── jobClaimFields.ts        # Shared claimedBy + claimedAt field definitions for job collections
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
| `ProductVideoList` | `components/product-video-list.tsx` | Client | Paginated video mention cards with sentiment badge overlay on thumbnail, creator avatar, timestamp, and all quotes rendered as stacked sentiment-colored strips. Links include `?snippetId=X` to deep-link into video detail. Props: `videos: ProductVideoItem[]`. Exports `ProductVideoItem`, `ProductVideoQuote` types. |
| `AccordionSection` | `components/accordion-section.tsx` | Client | Collapsible section with title/trailing/chevron, uses Radix Collapsible. Props: `title`, `trailing`, `defaultOpen`, `children`. Multiple can be open simultaneously. |
| `DescriptionTeaser` | `components/description-teaser.tsx` | Client | Truncated product description (~100 chars) with a "more" link that opens a bottom-sheet (Sheet) displaying the full text. Used in the product detail hero header. Props: `description: string`. |
| `IngredientChipGroup` | `components/ingredient-chip-group.tsx` | Client | Tappable ingredient pills (amber for restricted, neutral for others). Opens bottom-sheet listing all ingredients as collapsible rows (one open at a time). Each row shows index, name, functions, and expands to show description, function pills, CAS number, and restriction warnings. Optimized for 50+ items. Props: `items: IngredientItem[]`. Exports `IngredientItem` type. |
| `TraitChipGroup` | `components/trait-chip.tsx` | Client | Renders attribute/claim pills; tapping any chip opens a bottom-sheet (Sheet) listing ALL traits as collapsible rows, with the tapped one pre-expanded. Each row shows evidence in a blocky quote-style card: left-bordered quote block with ingredient pills or snippet text, plus store logo + name attribution below. Props: `items: TraitItem[]`. Exports `TraitItem`, `TraitEvidence` types. |
| `CreatorScoreCard` | `components/score-sheet.tsx` | Client | Tappable creator score badge (sentiment color + creator avatars). Opens bottom-sheet listing all creators with avatar, name, mention count, individual sentiment score, and per-channel platform links (YouTube/Instagram/TikTok pills with platform icons). Props: `avgSentiment`, `dominantSentiment`, `totalMentions`, `creators: CreatorScoreItem[]`. Exports `CreatorScoreItem`, `CreatorChannel` types. |
| `StoreScoreCard` | `components/score-sheet.tsx` | Client | Tappable store score badge (amber + store logos). Opens bottom-sheet listing all stores as white cards (`bg-card`) with logo, name, review count, star rating, and a `ScoreBadge` on the right. Props: `avgStoreRating`, `stores: StoreScoreItem[]`. |
| `ScoreBadge` | `components/score-sheet.tsx` | Server | Small rounded badge showing a star icon + numeric score (0-10), colored by tier (emerald/lime/amber/rose). Used inside store cards on both the product detail page and the StoreScoreCard bottom-sheet. Props: `score: number`. |
| `VideoDetailClient` | `components/video-detail-client.tsx` | Client | Full video detail page with YouTube IFrame API player, seekable timestamps, collapsible snippet blocks with product tiles, sentiment indicators, and quote cards. Supports `initialSnippetId` prop to auto-open a specific snippet and seek to its timestamp on load (used when deep-linking from product pages). Exports `VideoMentionItem`, `VideoQuote`, `VideoDetailClientProps` types. |

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

### Drizzle ORM Query Patterns

```typescript
const payload = await getPayload({ config: await config })
const db = payload.db.drizzle
const t = payload.db.tables  // e.g. t.products, t.brands, t.source_products, t.source_variants

// Table names are snake_case: products, brands, product_types, source_products, source_variants
// Column names are camelCase: t.source_products.ratingNum (NOT rating_num)
// Payload array fields → separate tables: products_ingredients, products_product_claims
// hasMany relationships → {collection}_rels join table (e.g. products_rels)
// source_variants has: sourceProduct (FK → source_products), sourceUrl (unique), gtin, variantLabel, variantDimension, isDefault
// GTINs and sourceUrls live on source_variants, NOT source_products
//
// To join products → source_products (for ratings, etc.), go through source_variants:
//   .innerJoin(t.source_variants, eq(t.source_variants.gtin, t.products.gtin))
//   .innerJoin(t.source_products, eq(t.source_variants.sourceProduct, t.source_products.id))
// Use leftJoin instead of innerJoin when products without source data should still appear.

// Image sizes (from Media collection upload config) are flattened DB columns:
// sizes_thumbnail_url, sizes_card_url, sizes_detail_url — access via sql template:
//   sql`coalesce(${t.media}.sizes_card_url, ${t.media}.url)`
// Join: .leftJoin(t.media, eq(t.products.image, t.media.id))
```

### Media Image Sizes

The `media` collection defines three image variants generated on upload via sharp:

| Size | Dimensions | Fit | Used For |
|------|-----------|-----|----------|
| `thumbnail` | 96x96 | inside (no enlarge) | List items (search, ranked lists) |
| `card` | 320x240 | inside (no enlarge) | ProductCard carousels (160px CSS @ 2x) |
| `detail` | 780x780 | inside (no enlarge) | Product detail page hero image |

All sizes use `fit: 'inside'` to preserve the full image (no cropping). Frontend uses `object-contain` + inner padding on containers so the image is fully visible with breathing room. All pages use `coalesce(sized_url, original_url)` so the original image is used as fallback when no sized variant exists (e.g. non-image media or pre-existing uploads).

### Product Detail Pages

- URL param is **GTIN** (not numeric ID): `/products/[gtin]`
- `notFound()` triggers the custom `not-found.tsx` which explains AnySkin only covers cosmetics and offers a feedback form
- **Sections** (top to bottom): Hero (image + name + brand + **description teaser** + pills + **tappable score badges**), then accordion sections via `<AccordionSection>` (Radix Collapsible-based, multiple can be open): Videos (open, unified paginated list via `ProductVideoList` — each card shows thumbnail with sentiment overlay + duration, title, creator avatar, timestamp, and optional featured quote strip; links to `/videos/{id}?snippetId={snippetId}` for deep-linking), Prices & Stores (open, grid cards with sparkline), Ingredients (closed by default). Description is shown as a truncated teaser in the hero header via `DescriptionTeaser` component; tapping "more" opens a bottom-sheet with the full text.
- **Sentiment scoring**: Per-mention score is -1 to +1. Overall sentiment displayed as a tappable `CreatorScoreCard` badge in the hero section; tapping opens a bottom-sheet listing all creators with individual scores.
- **Store scoring**: Weighted average of store ratings displayed as a tappable `StoreScoreCard` badge in the hero section; tapping opens a bottom-sheet listing all stores with individual star ratings and review counts.
- **Store logos**: `StoreLogo` component renders inline SVG for dm/rossmann/mueller based on `source` slug. DM uses `h-8`, Rossmann `h-6` (wide aspect ~6.25:1), Müller `h-7`. Also stored in worker driver `logoSvg` field.
- **Store cards**: White (`bg-card`) cards with logo on left in a `bg-muted/40` box, price + per-unit + rating + sparkline in the middle, and a `ScoreBadge` (tier-colored score out of 10) on the right. External link icon. Grid: 1 col mobile, 2 cols sm, 3 cols lg.
- **Price history**: Fetched from `source_products_price_history` table, grouped by source product, shows latest price with delta vs previous. **Sparkline** graph shows last 12 months (chronological, oldest→newest) using `<Sparkline />` component (green if price dropped, red if rose).
- **Videos section**: Unified paginated list of all video mentions via `ProductVideoList`. Each card shows thumbnail with sentiment icon overlay + duration badge, title, creator avatar, timestamp at mention, and an optional featured quote strip (the quote with the highest absolute sentiment score for that mention). Clicking a card navigates to `/videos/{id}?snippetId={snippetId}`, which deep-links into the video detail page with that snippet auto-opened and its timestamp seeked.

### CSS Specificity with Tailwind v4

Tailwind v4 utilities live in `@layer utilities`. Custom CSS outside a layer has lower specificity. When overriding Tailwind classes conditionally (e.g. in media queries), use `!important`:

```css
@media (display-mode: standalone) {
  .standalone-bottom-pad {
    padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px) + 1.5rem) !important;
  }
}
```

## Keeping This File Up to Date

Whenever you make changes to the server codebase, **update this file** to reflect those changes. This includes additions or modifications to collections, fields, hooks, access control, components, actions, endpoints, or any server-side patterns documented here. Documentation must stay in sync with the code.

For changes that affect the overall repository layout or cross both server and worker, also update the root `AGENTS.md`. See the root file for the full policy.

## Resources

- Docs: https://payloadcms.com/docs
- LLM Context: https://payloadcms.com/llms-full.txt
- GitHub: https://github.com/payloadcms/payload
- Examples: https://github.com/payloadcms/payload/tree/main/examples
- Templates: https://github.com/payloadcms/payload/tree/main/templates
