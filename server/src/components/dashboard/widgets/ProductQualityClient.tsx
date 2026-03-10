'use client'

import { useDashboardState } from '../dashboard-store'

interface QualityBarProps {
  label: string
  count: number
  total: number
  color: string
}

function QualityBar({ label, count, total, color }: QualityBarProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ marginBottom: '10px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '3px',
          fontSize: '0.8125rem',
        }}
      >
        <span style={{ color: 'var(--theme-text)', fontWeight: 500 }}>{label}</span>
        <span
          style={{
            color: 'var(--theme-elevation-500)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div
        style={{
          height: '6px',
          backgroundColor: 'var(--theme-elevation-100)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}

export default function ProductQualityClient() {
  const { snapshot } = useDashboardState()

  if (!snapshot) return null

  const { productQuality: q } = snapshot
  if (q.total === 0) {
    return (
      <div
        style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--theme-elevation-500)',
          fontSize: '0.875rem',
          border: '1px solid var(--theme-elevation-150)',
          backgroundColor: 'var(--theme-elevation-0)',
        }}
      >
        No products yet
      </div>
    )
  }

  // Compute overall completeness: 6 quality dimensions
  const dimensions = [
    q.withImage,
    q.withBrand,
    q.withProductType,
    q.withIngredients,
    q.withDescription,
    q.withScoreHistory,
  ]
  const avgCompleteness = Math.round(
    (dimensions.reduce((sum, n) => sum + n, 0) / (dimensions.length * q.total)) * 100,
  )

  return (
    <div
      style={{
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {/* Overall completeness score */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '12px',
        }}
      >
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 500,
            color: 'var(--theme-elevation-500)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Data Completeness
        </span>
        <span
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color:
              avgCompleteness >= 80
                ? '#22c55e'
                : avgCompleteness >= 50
                  ? '#f59e0b'
                  : '#ef4444',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {avgCompleteness}%
        </span>
      </div>

      {/* Per-field bars */}
      <QualityBar label="Image" count={q.withImage} total={q.total} color="#3b82f6" />
      <QualityBar label="Brand" count={q.withBrand} total={q.total} color="#8b5cf6" />
      <QualityBar
        label="Product Type"
        count={q.withProductType}
        total={q.total}
        color="#6366f1"
      />
      <QualityBar
        label="Ingredients"
        count={q.withIngredients}
        total={q.total}
        color="#06b6d4"
      />
      <QualityBar
        label="Description"
        count={q.withDescription}
        total={q.total}
        color="#14b8a6"
      />
      <QualityBar
        label="Score History"
        count={q.withScoreHistory}
        total={q.total}
        color="#f59e0b"
      />
    </div>
  )
}
