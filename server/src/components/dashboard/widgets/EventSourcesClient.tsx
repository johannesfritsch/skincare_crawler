'use client'

import { useDashboardState } from '../dashboard-store'

const SOURCE_LABELS: Record<string, string> = {
  dm: 'dm',
  mueller: 'Müller',
  rossmann: 'Rossmann',
  purish: 'PURISH',
}

const SOURCE_COLORS: Record<string, string> = {
  dm: '#e4002b',
  mueller: '#e85b2d',
  rossmann: '#c8102e',
  purish: '#1a1a1a',
}

export default function EventSourcesClient() {
  const { data } = useDashboardState()

  if (!data || data.bySource.length === 0) {
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

  const maxTotal = Math.max(...data.bySource.map((s) => s.total), 1)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      {data.bySource.map((s) => (
        <div
          key={s.source}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '80px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--theme-text)',
              flexShrink: 0,
            }}
          >
            {SOURCE_LABELS[s.source] ?? s.source}
          </div>
          <div
            style={{
              flex: 1,
              height: '24px',
              backgroundColor: 'var(--theme-elevation-100)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(s.total / maxTotal) * 100}%`,
                backgroundColor: SOURCE_COLORS[s.source] ?? '#94a3b8',
                opacity: 0.8,
                transition: 'width 300ms ease',
              }}
            />
            {s.errors > 0 && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  height: '100%',
                  width: `${(s.errors / maxTotal) * 100}%`,
                  backgroundColor: '#ef4444',
                  opacity: 0.9,
                }}
              />
            )}
          </div>
          <div
            style={{
              width: '60px',
              textAlign: 'right',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--theme-text)',
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {s.total.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  )
}
