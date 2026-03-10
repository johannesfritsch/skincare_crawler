'use client'

import { useDashboardState } from '../dashboard-store'

interface EntityCardProps {
  label: string
  value: number
  color?: string
}

function EntityCard({ label, value, color }: EntityCardProps) {
  return (
    <div
      style={{
        padding: '12px',
        backgroundColor: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-100)',
        textAlign: 'center',
        minWidth: '100px',
      }}
    >
      <div
        style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: color ?? 'var(--theme-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toLocaleString()}
      </div>
      <div
        style={{
          fontSize: '0.6875rem',
          fontWeight: 500,
          color: 'var(--theme-elevation-500)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginTop: '2px',
        }}
      >
        {label}
      </div>
    </div>
  )
}

export default function DatabaseOverviewClient() {
  const { snapshot } = useDashboardState()

  if (!snapshot) return null

  const { entities } = snapshot

  return (
    <div
      style={{
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: '8px',
        }}
      >
        <EntityCard label="Products" value={entities.products} color="#3b82f6" />
        <EntityCard label="Variants" value={entities.productVariants} color="#6366f1" />
        <EntityCard label="GTINs" value={entities.uniqueGtins} color="#8b5cf6" />
        <EntityCard label="Source Products" value={entities.sourceProducts} />
        <EntityCard label="Source Variants" value={entities.sourceVariants} />
        <EntityCard label="Brands" value={entities.brands} color="#ec4899" />
        <EntityCard label="Ingredients" value={entities.ingredients} color="#06b6d4" />
        <EntityCard label="Videos" value={entities.videos} color="#f59e0b" />
        <EntityCard label="Creators" value={entities.creators} color="#10b981" />
        <EntityCard label="Channels" value={entities.channels} color="#14b8a6" />
        <EntityCard label="Media Files" value={entities.mediaFiles} color="#64748b" />
      </div>
    </div>
  )
}
