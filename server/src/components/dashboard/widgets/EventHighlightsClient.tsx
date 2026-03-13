'use client'

import { useDashboardState } from '../dashboard-store'

interface MetricProps {
  label: string
  value: string
  icon: string
}

function Metric({ label, value, icon }: MetricProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px',
        backgroundColor: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-100)',
      }}
    >
      <span style={{ fontSize: '1.25rem' }}>{icon}</span>
      <div>
        <div
          style={{
            fontSize: '0.6875rem',
            fontWeight: 500,
            color: 'var(--theme-elevation-500)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: '1.125rem',
            fontWeight: 700,
            color: 'var(--theme-text)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '\u2013'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function fmt(n: number): string {
  return n.toLocaleString()
}

export default function EventHighlightsClient() {
  const { data } = useDashboardState()

  if (!data) return null

  const h = data.highlights

  // Only show metrics with non-zero values, plus always show the essential ones
  const metrics: MetricProps[] = [
    { icon: '\uD83D\uDCE6', label: 'Crawled', value: fmt(h.productsCrawled) },
    { icon: '\uD83D\uDD0D', label: 'Discovered', value: fmt(h.productsDiscovered) },
  ]

  if (h.productsAggregated > 0)
    metrics.push({ icon: '\uD83D\uDD17', label: 'Aggregated', value: fmt(h.productsAggregated) })
  if (h.productsSearched > 0)
    metrics.push({ icon: '\uD83D\uDCDD', label: 'Searched', value: fmt(h.productsSearched) })
  if (h.ingredientsCrawled > 0)
    metrics.push({ icon: '\uD83E\uDDEA', label: 'Ingredients Crawled', value: fmt(h.ingredientsCrawled) })
  if (h.ingredientsDiscovered > 0)
    metrics.push({ icon: '\uD83E\uDDEC', label: 'Ingredients Disc.', value: fmt(h.ingredientsDiscovered) })
  if (h.videosCrawled > 0)
    metrics.push({ icon: '\uD83D\uDCE5', label: 'Videos Crawled', value: fmt(h.videosCrawled) })
  if (h.videosProcessed > 0)
    metrics.push({ icon: '\uD83C\uDFAC', label: 'Videos Processed', value: fmt(h.videosProcessed) })
  if (h.videosDiscovered > 0)
    metrics.push({ icon: '\uD83D\uDCF9', label: 'Videos Discovered', value: fmt(h.videosDiscovered) })

  // Price section
  if (h.priceChanges > 0) {
    const priceDetail =
      h.priceDrops > 0 || h.priceIncreases > 0
        ? `${fmt(h.priceChanges)} (\u2193${h.priceDrops} \u2191${h.priceIncreases})`
        : fmt(h.priceChanges)
    metrics.push({ icon: '\uD83D\uDCB0', label: 'Price Changes', value: priceDetail })
  }

  if (h.variantsDisappeared > 0)
    metrics.push({ icon: '\uD83D\uDC7B', label: 'Disappeared', value: fmt(h.variantsDisappeared) })
  if (h.botChecks > 0)
    metrics.push({ icon: '\uD83E\uDD16', label: 'Bot Checks', value: fmt(h.botChecks) })

  metrics.push({ icon: '\uD83E\uDDE0', label: 'Tokens Used', value: formatTokens(h.tokensUsed) })
  metrics.push({ icon: '\u23F1\uFE0F', label: 'Avg Batch', value: formatDuration(h.avgBatchDurationMs) })

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
        gap: '8px',
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {metrics.map((m) => (
        <Metric key={m.label} icon={m.icon} label={m.label} value={m.value} />
      ))}
    </div>
  )
}
