'use client'

import { useEffect, useCallback, useRef } from 'react'
import {
  useDashboardState,
  setDashboardData,
  setDashboardRange,
  setDashboardLoading,
  setDashboardError,
  type DashboardRange,
} from './dashboard-store'

const POLL_INTERVAL_MS = 30_000
const RANGES: { label: string; value: DashboardRange }[] = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
]

export default function DashboardProvider() {
  const { range, loading, data, error } = useDashboardState()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(
    async (r: DashboardRange) => {
      try {
        const res = await fetch(`/api/dashboard/events?range=${r}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          setDashboardError(`HTTP ${res.status}`)
          return
        }
        const data = await res.json()
        setDashboardData(data)
      } catch (err) {
        setDashboardError(String(err))
      }
    },
    [],
  )

  // Fetch on mount and when range changes
  useEffect(() => {
    setDashboardLoading(true)
    fetchData(range)

    // Set up polling
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => fetchData(range), POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [range, fetchData])

  const handleRangeChange = (r: DashboardRange) => {
    if (r !== range) {
      setDashboardRange(r)
    }
  }

  return (
    <div style={{ marginBottom: '24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '1.25rem',
            fontWeight: 600,
            color: 'var(--theme-text)',
          }}
        >
          Event Dashboard
          {loading && (
            <span
              style={{
                marginLeft: '8px',
                fontSize: '0.75rem',
                fontWeight: 400,
                color: 'var(--theme-elevation-500)',
              }}
            >
              Loading…
            </span>
          )}
        </h2>

        <div
          style={{
            display: 'flex',
            gap: '2px',
            backgroundColor: 'var(--theme-elevation-100)',
            padding: '2px',
          }}
        >
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => handleRangeChange(r.value)}
              style={{
                padding: '4px 12px',
                fontSize: '0.8125rem',
                fontWeight: range === r.value ? 600 : 400,
                border: 'none',
                
                cursor: 'pointer',
                backgroundColor:
                  range === r.value ? 'var(--theme-elevation-0)' : 'transparent',
                color:
                  range === r.value
                    ? 'var(--theme-text)'
                    : 'var(--theme-elevation-500)',
                boxShadow:
                  range === r.value ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 150ms ease',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: '8px',
          fontSize: '0.75rem',
          fontFamily: 'monospace',
          color: 'var(--theme-elevation-500)',
        }}
      >
        {error && <span style={{ color: '#ef4444' }}>Error: {error} | </span>}
        {data ? (
          <>
            range={data.range} | since={data.since} | total={data.summary.totalEvents} |
            errors={data.summary.errors} | warnings={data.summary.warnings} |
            timeline={data.timeline.length} buckets |
            domains={data.byDomain.length} |
            sources={data.bySource.length} |
            jobs={data.byJobCollection.length} |
            recentErrors={data.recentErrors.length} |
            highlights: crawled={data.highlights.productsCrawled} discovered={data.highlights.productsDiscovered}
          </>
        ) : (
          loading ? 'Fetching...' : 'No data'
        )}
      </div>
    </div>
  )
}
