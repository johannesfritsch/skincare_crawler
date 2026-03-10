'use client'

import { useDashboardState } from '../dashboard-store'

const COLLECTION_LABELS: Record<string, string> = {
  'product-crawls': 'Product Crawls',
  'product-discoveries': 'Product Discovery',
  'product-searches': 'Product Search',
  'product-aggregations': 'Aggregation',
  'ingredients-discoveries': 'Ingredients Discovery',
  'ingredient-crawls': 'Ingredient Crawls',
  'video-discoveries': 'Video Discovery',
  'video-processings': 'Video Processing',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const cellStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: '0.8125rem',
  fontVariantNumeric: 'tabular-nums',
  borderBottom: '1px solid var(--theme-elevation-100)',
}

const headerStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  fontSize: '0.6875rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--theme-elevation-500)',
}

export default function JobQueueClient() {
  const { snapshot } = useDashboardState()

  if (!snapshot) return null

  const { jobQueue, workers } = snapshot

  // Filter to only collections that have at least one job
  const activeCollections = jobQueue.filter(
    (j) =>
      j.pending > 0 ||
      j.inProgress > 0 ||
      j.completed > 0 ||
      j.failed > 0,
  )

  return (
    <div
      style={{
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {/* Workers section */}
      <div style={{ marginBottom: '16px' }}>
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
          Workers
        </div>
        {workers.length === 0 ? (
          <div
            style={{
              fontSize: '0.8125rem',
              color: 'var(--theme-elevation-400)',
            }}
          >
            No workers registered
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            {workers.map((w) => {
              const isActive =
                w.status === 'active' &&
                w.lastSeenAt &&
                Date.now() - new Date(w.lastSeenAt).getTime() <
                  5 * 60 * 1000
              return (
                <div
                  key={w.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    backgroundColor: 'var(--theme-elevation-50)',
                    border: '1px solid var(--theme-elevation-100)',
                    fontSize: '0.8125rem',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: isActive
                        ? '#22c55e'
                        : w.status === 'active'
                          ? '#f59e0b'
                          : '#ef4444',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 500, color: 'var(--theme-text)' }}>
                    {w.name}
                  </span>
                  {w.lastSeenAt && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        color: 'var(--theme-elevation-400)',
                      }}
                    >
                      {timeAgo(w.lastSeenAt)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Job queue table */}
      {activeCollections.length === 0 ? (
        <div
          style={{
            padding: '16px',
            textAlign: 'center',
            color: 'var(--theme-elevation-400)',
            fontSize: '0.8125rem',
          }}
        >
          No jobs
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...headerStyle, textAlign: 'left' }}>
                  Job Type
                </th>
                <th style={{ ...headerStyle, textAlign: 'right' }}>
                  Pending
                </th>
                <th style={{ ...headerStyle, textAlign: 'right' }}>
                  Running
                </th>
                <th style={{ ...headerStyle, textAlign: 'right' }}>
                  Completed
                </th>
                <th style={{ ...headerStyle, textAlign: 'right' }}>
                  Failed
                </th>
                <th style={{ ...headerStyle, textAlign: 'right' }}>
                  Stale
                </th>
              </tr>
            </thead>
            <tbody>
              {activeCollections.map((row) => (
                <tr key={row.collection}>
                  <td
                    style={{
                      ...cellStyle,
                      fontWeight: 500,
                      color: 'var(--theme-text)',
                    }}
                  >
                    <a
                      href={`/admin/collections/${row.collection}`}
                      style={{
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.textDecoration = 'underline'
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.textDecoration = 'none'
                      }}
                    >
                      {COLLECTION_LABELS[row.collection] ?? row.collection}
                    </a>
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: 'right',
                      color:
                        row.pending > 0
                          ? '#3b82f6'
                          : 'var(--theme-elevation-400)',
                      fontWeight: row.pending > 0 ? 600 : 400,
                    }}
                  >
                    {row.pending || '\u2013'}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: 'right',
                      color:
                        row.active > 0
                          ? '#f59e0b'
                          : 'var(--theme-elevation-400)',
                      fontWeight: row.active > 0 ? 600 : 400,
                    }}
                  >
                    {row.active || '\u2013'}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: 'right',
                      color: '#22c55e',
                    }}
                  >
                    {row.completed || '\u2013'}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: 'right',
                      color:
                        row.failed > 0
                          ? '#ef4444'
                          : 'var(--theme-elevation-400)',
                      fontWeight: row.failed > 0 ? 600 : 400,
                    }}
                  >
                    {row.failed || '\u2013'}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: 'right',
                      color:
                        row.stale > 0
                          ? '#ef4444'
                          : 'var(--theme-elevation-400)',
                      fontWeight: row.stale > 0 ? 600 : 400,
                    }}
                  >
                    {row.stale || '\u2013'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
