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

const cellStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '0.8125rem',
  fontVariantNumeric: 'tabular-nums',
  borderBottom: '1px solid var(--theme-elevation-100)',
}

const headerStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--theme-elevation-500)',
}

export default function EventJobsClient() {
  const { data } = useDashboardState()

  if (!data || data.byJobCollection.length === 0) {
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
        No job activity
      </div>
    )
  }

  return (
    <div
      style={{
        overflowX: 'auto',
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...headerStyle, textAlign: 'left' }}>Job Type</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Started</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Completed</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Failed</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Retrying</th>
          </tr>
        </thead>
        <tbody>
          {data.byJobCollection.map((row) => (
            <tr key={row.collection}>
              <td style={{ ...cellStyle, fontWeight: 500, color: 'var(--theme-text)' }}>
                {COLLECTION_LABELS[row.collection] ?? row.collection}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', color: '#3b82f6' }}>
                {row.started || '–'}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', color: '#22c55e' }}>
                {row.completed || '–'}
              </td>
              <td
                style={{
                  ...cellStyle,
                  textAlign: 'right',
                  color: row.failed > 0 ? '#ef4444' : 'var(--theme-elevation-400)',
                  fontWeight: row.failed > 0 ? 600 : 400,
                }}
              >
                {row.failed || '–'}
              </td>
              <td
                style={{
                  ...cellStyle,
                  textAlign: 'right',
                  color: row.retrying > 0 ? '#f59e0b' : 'var(--theme-elevation-400)',
                }}
              >
                {row.retrying || '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
