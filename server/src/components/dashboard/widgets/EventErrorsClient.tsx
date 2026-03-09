'use client'

import { useDashboardState } from '../dashboard-store'

const COLLECTION_LABELS: Record<string, string> = {
  'product-crawls': 'Crawl',
  'product-discoveries': 'Discovery',
  'product-searches': 'Search',
  'product-aggregations': 'Aggregation',
  'ingredients-discoveries': 'Ingredients',
  'ingredient-crawls': 'Ingredient Crawl',
  'video-discoveries': 'Video Disc.',
  'video-processings': 'Video Proc.',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function EventErrorsClient() {
  const { data } = useDashboardState()

  if (!data || data.recentErrors.length === 0) {
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
        No errors in this time range
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {data.recentErrors.map((err) => (
        <div
          key={err.id}
          style={{
            display: 'flex',
            gap: '12px',
            padding: '10px 12px',
            backgroundColor: 'var(--theme-elevation-50)',
            borderLeft: '3px solid #ef4444',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '2px',
              }}
            >
              {err.name && (
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    backgroundColor: 'var(--theme-elevation-100)',
                    padding: '1px 6px',
                    
                    color: '#ef4444',
                  }}
                >
                  {err.name}
                </span>
              )}
              {err.jobCollection && (
                <span
                  style={{
                    fontSize: '0.6875rem',
                    color: 'var(--theme-elevation-500)',
                  }}
                >
                  {COLLECTION_LABELS[err.jobCollection] ?? err.jobCollection}
                  {err.jobId ? ` #${err.jobId}` : ''}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: '0.8125rem',
                color: 'var(--theme-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {err.message}
            </div>
          </div>
          <div
            style={{
              fontSize: '0.6875rem',
              color: 'var(--theme-elevation-400)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {timeAgo(err.createdAt)}
          </div>
        </div>
      ))}
    </div>
  )
}
