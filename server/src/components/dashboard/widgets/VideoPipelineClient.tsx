'use client'

import { useDashboardState } from '../dashboard-store'

function MiniStat({
  label,
  value,
  color,
}: {
  label: string
  value: number | string
  color?: string
}) {
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
          color: color ?? 'var(--theme-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div
        style={{
          fontSize: '0.6875rem',
          color: 'var(--theme-elevation-500)',
          marginTop: '2px',
        }}
      >
        {label}
      </div>
    </div>
  )
}

export default function VideoPipelineClient() {
  const { snapshot } = useDashboardState()

  if (!snapshot) return null

  const v = snapshot.videoPipeline

  if (v.total === 0) {
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
        No videos yet
      </div>
    )
  }

  const processedPct =
    v.total > 0 ? Math.round((v.processed / v.total) * 100) : 0

  return (
    <div
      style={{
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {/* Processing progress */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '6px',
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
            Processing
          </span>
          <span
            style={{
              fontSize: '0.8125rem',
              color: 'var(--theme-elevation-500)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {v.processed.toLocaleString()} / {v.total.toLocaleString()} ({processedPct}%)
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
              width: `${processedPct}%`,
              backgroundColor: processedPct === 100 ? '#22c55e' : '#f59e0b',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
          gap: '6px',
          marginBottom: '12px',
        }}
      >
        <MiniStat label="Snippets" value={v.totalSnippets} />
        <MiniStat label="By Barcode" value={v.snippetsByBarcode} color="#3b82f6" />
        <MiniStat label="By Visual" value={v.snippetsByVisual} color="#8b5cf6" />
        <MiniStat label="Mentions" value={v.totalMentions} />
        <MiniStat label="Products" value={v.productsWithMentions} color="#06b6d4" />
        <MiniStat label="Transcripts" value={v.withTranscript} color="#14b8a6" />
      </div>

      {/* Sentiment breakdown */}
      {v.totalMentions > 0 && (
        <div>
          <div
            style={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              color: 'var(--theme-elevation-500)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '6px',
            }}
          >
            Sentiment
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: '6px',
            }}
          >
            <MiniStat label="Positive" value={v.mentionsByPositive} color="#22c55e" />
            <MiniStat label="Neutral" value={v.mentionsByNeutral} color="#64748b" />
            <MiniStat label="Negative" value={v.mentionsByNegative} color="#ef4444" />
            <MiniStat label="Mixed" value={v.mentionsByMixed} color="#f59e0b" />
          </div>
        </div>
      )}

      {/* Channels by platform */}
      {v.channelsByPlatform.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div
            style={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              color: 'var(--theme-elevation-500)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '6px',
            }}
          >
            Channels
          </div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
            }}
          >
            {v.channelsByPlatform.map((ch) => (
              <span
                key={ch.platform}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  backgroundColor: 'var(--theme-elevation-50)',
                  border: '1px solid var(--theme-elevation-100)',
                  color: 'var(--theme-text)',
                }}
              >
                {ch.platform}: {ch.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
