'use client'

import { useDashboardState } from '../dashboard-store'

const SOURCE_LABELS: Record<string, string> = {
  dm: 'dm',
  mueller: 'Muller',
  rossmann: 'Rossmann',
  purish: 'PURISH',
}

const SOURCE_COLORS: Record<string, string> = {
  dm: '#e4002b',
  mueller: '#e85b2d',
  rossmann: '#c8102e',
  purish: '#1a1a1a',
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

export default function SourceCoverageClient() {
  const { snapshot } = useDashboardState()

  if (!snapshot || snapshot.sourceCoverage.length === 0) {
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
        No source data
      </div>
    )
  }

  return (
    <div
      style={{
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...headerStyle, textAlign: 'left' }}>Store</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Products</th>
            <th style={{ ...headerStyle, textAlign: 'center' }}>Crawled</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Variants</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>GTINs</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Avg Rating</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.sourceCoverage.map((row) => {
            const crawlPct =
              row.total > 0 ? Math.round((row.withVariants / row.total) * 100) : 0
            const color = SOURCE_COLORS[row.source] ?? '#64748b'

            return (
              <tr key={row.source}>
                <td
                  style={{
                    ...cellStyle,
                    fontWeight: 600,
                    color,
                  }}
                >
                  {SOURCE_LABELS[row.source] ?? row.source}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  {row.total.toLocaleString()}
                </td>
                <td style={{ ...cellStyle, textAlign: 'center' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        maxWidth: '80px',
                        height: '6px',
                        backgroundColor: 'var(--theme-elevation-100)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${crawlPct}%`,
                          backgroundColor:
                            crawlPct === 100 ? '#22c55e' : '#3b82f6',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color:
                          crawlPct === 100
                            ? '#22c55e'
                            : 'var(--theme-elevation-500)',
                        fontVariantNumeric: 'tabular-nums',
                        minWidth: '36px',
                      }}
                    >
                      {crawlPct}%
                    </span>
                  </div>
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  {row.variants.toLocaleString()}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  {row.withGtin.toLocaleString()}
                </td>
                <td
                  style={{
                    ...cellStyle,
                    textAlign: 'right',
                    color:
                      row.avgRating != null
                        ? 'var(--theme-text)'
                        : 'var(--theme-elevation-400)',
                  }}
                >
                  {row.avgRating != null ? (
                    <>
                      {row.avgRating.toFixed(1)}
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          color: 'var(--theme-elevation-400)',
                          marginLeft: '4px',
                        }}
                      >
                        ({row.avgRatingCount?.toLocaleString() ?? '0'} avg)
                      </span>
                    </>
                  ) : (
                    '\u2013'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
