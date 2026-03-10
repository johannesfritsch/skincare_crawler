'use client'

import { useDashboardState } from '../dashboard-store'

export default function IngredientStatsClient() {
  const { data } = useDashboardState()

  if (!data) return null

  const { ingredientStats } = data
  const { total, crawled, uncrawled, sourceGroups } = ingredientStats

  const crawledPct = total > 0 ? Math.round((crawled / total) * 100) : 0

  // Source groups: how many ingredients have 0, 1, 2 sources
  const withNoSource = sourceGroups.find((g) => g.sourceCount === 0)?.ingredients ?? 0
  const withOneSource = sourceGroups.find((g) => g.sourceCount === 1)?.ingredients ?? 0
  const withTwoPlus = sourceGroups
    .filter((g) => g.sourceCount >= 2)
    .reduce((sum, g) => sum + g.ingredients, 0)

  return (
    <div
      style={{
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {/* Header row: total + progress bar */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '8px',
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
            Ingredients
          </span>
          <span
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--theme-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {total.toLocaleString()}
          </span>
        </div>

        {/* Progress bar */}
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
              width: `${crawledPct}%`,
              backgroundColor: crawledPct === 100 ? '#22c55e' : '#3b82f6',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '4px',
            fontSize: '0.75rem',
            color: 'var(--theme-elevation-500)',
          }}
        >
          <span>{crawled.toLocaleString()} crawled ({crawledPct}%)</span>
          <span>{uncrawled.toLocaleString()} uncrawled</span>
        </div>
      </div>

      {/* Source coverage breakdown */}
      <div
        style={{
          fontSize: '0.6875rem',
          fontWeight: 500,
          color: 'var(--theme-elevation-500)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: '8px',
        }}
      >
        Source Coverage
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '8px',
        }}
      >
        <SourceCard label="No source" count={withNoSource} total={total} color="#ef4444" />
        <SourceCard label="1 source" count={withOneSource} total={total} color="#f59e0b" />
        <SourceCard label="2+ sources" count={withTwoPlus} total={total} color="#22c55e" />
      </div>
    </div>
  )
}

function SourceCard({
  label,
  count,
  total,
  color,
}: {
  label: string
  count: number
  total: number
  color: string
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <div
      style={{
        padding: '10px',
        backgroundColor: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-100)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '1.125rem',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count.toLocaleString()}
      </div>
      <div
        style={{
          fontSize: '0.6875rem',
          color: 'var(--theme-elevation-500)',
          marginTop: '2px',
        }}
      >
        {label} ({pct}%)
      </div>
    </div>
  )
}
