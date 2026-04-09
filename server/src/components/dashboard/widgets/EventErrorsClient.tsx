'use client'

import { useDashboardState } from '../dashboard-store'
import { WidgetContainer } from './WidgetContainer'

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

/** Extract the most interesting fields from the error data for display */
function extractKeyData(data: Record<string, unknown> | null): Array<{ key: string; value: string }> {
  if (!data) return []
  const result: Array<{ key: string; value: string }> = []
  const interestingKeys = ['url', 'source', 'ingredient', 'ingredientName', 'gtin', 'title', 'brand', 'product', 'error', 'reason']
  for (const key of interestingKeys) {
    if (key in data && data[key] != null && data[key] !== '') {
      const val = String(data[key])
      if (val.length <= 120) {
        result.push({ key, value: val })
      } else {
        result.push({ key, value: val.slice(0, 117) + '...' })
      }
    }
    if (result.length >= 3) break // max 3 fields to keep compact
  }
  return result
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
      <WidgetContainer>
        <div style={{ padding: '8px 0', textAlign: 'center', color: 'var(--theme-elevation-500)', fontSize: '0.875rem' }}>
          No errors in this time range
        </div>
      </WidgetContainer>
    )
  }

  return (
    <WidgetContainer>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
      {data.recentErrors.map((err) => {
        const keyData = extractKeyData(err.data)
        const jobLink =
          err.jobCollection && err.jobId
            ? `/admin/collections/${err.jobCollection}/${err.jobId}`
            : null

        return (
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
                  <>
                    {jobLink ? (
                      <a
                        href={jobLink}
                        style={{
                          fontSize: '0.6875rem',
                          color: 'var(--theme-elevation-500)',
                          textDecoration: 'none',
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.textDecoration = 'underline'
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.textDecoration = 'none'
                        }}
                      >
                        {COLLECTION_LABELS[err.jobCollection] ?? err.jobCollection}
                        {err.jobId ? ` #${err.jobId}` : ''}
                      </a>
                    ) : (
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
                  </>
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
              {/* Key data fields */}
              {keyData.length > 0 && (
                <div
                  style={{
                    marginTop: '4px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px 8px',
                  }}
                >
                  {keyData.map(({ key, value }) => (
                    <span
                      key={key}
                      style={{
                        fontSize: '0.6875rem',
                        color: 'var(--theme-elevation-400)',
                        fontFamily: 'monospace',
                      }}
                    >
                      <span style={{ color: 'var(--theme-elevation-500)' }}>
                        {key}:
                      </span>{' '}
                      {value}
                    </span>
                  ))}
                </div>
              )}
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
        )
      })}
      </div>
    </WidgetContainer>
  )
}
