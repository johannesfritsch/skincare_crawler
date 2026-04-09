# Dashboard Widgets

## Architecture

Each dashboard widget uses a **server shell + client component** pattern:

- **Server shell** (`WidgetName.tsx`): Default export, no `'use client'`. Imports and renders the client component.
- **Client component** (`WidgetNameClient.tsx`): Has `'use client'` directive. Subscribes to dashboard data via `useDashboardState()` hook.

## Data Flow

1. `DashboardProvider` (in `beforeDashboard`) polls two endpoints every 30s:
   - `GET /api/dashboard/events?range=...` → time-scoped event data (`data`)
   - `GET /api/dashboard/snapshot` → current database state (`snapshot`)
2. Data is stored in module-level pub/sub (`dashboard-store.ts`)
3. Client widgets call `useDashboardState()` → `{ data, snapshot }`
4. Event widgets read `data`, snapshot widgets read `snapshot`

## Widget Styling Rules

- **No Tailwind** — admin panel doesn't load it
- **All styling via inline `style` objects** using Payload CSS variables
- **Outer container**: wrap content with `<WidgetContainer>` from `./WidgetContainer` — provides consistent border, background, and padding:
  ```tsx
  import { WidgetContainer } from './WidgetContainer'
  // ...
  return <WidgetContainer>{/* widget content */}</WidgetContainer>
  ```
- **Cards/cells** inside widgets use:
  ```
  backgroundColor: 'var(--theme-elevation-50)'
  border: '1px solid var(--theme-elevation-100)'
  ```
- **Text colors**: `var(--theme-text)` for primary, `var(--theme-elevation-500)` for muted
- **Font sizes**: `13px` body, `11px` labels, `1.25rem` for large numbers
- **Grid layout**: `gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))'`

## Registration

In `payload.config.ts` under `admin.dashboard.widgets`:
```typescript
{
  slug: 'widget-slug',
  label: 'Widget Label',
  ComponentPath: '/components/dashboard/widgets/WidgetName',
  minWidth: 'small' | 'medium' | 'large',
  maxWidth: 'small' | 'medium' | 'large' | 'full',
}
```

Add to `admin.dashboard.defaultLayout`:
```typescript
{ widgetSlug: 'widget-slug', width: 'medium' | 'full' }
```

After creating new widgets, regenerate import map:
```bash
rm -f src/app/(payload)/admin/importMap.js && pnpm payload generate:importmap
```
