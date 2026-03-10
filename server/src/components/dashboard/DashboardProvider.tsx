'use client'

import { useEffect, useCallback, useRef } from 'react'
import {
  useDashboardState,
  setDashboardData,
  setSnapshotData,
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

  const fetchEvents = useCallback(
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

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/snapshot', {
        credentials: 'include',
      })
      if (!res.ok) return // non-critical — snapshot is supplementary
      const snap = await res.json()
      setSnapshotData(snap)
    } catch {
      // silently ignore snapshot errors
    }
  }, [])

  // Fetch on mount and when range changes
  useEffect(() => {
    setDashboardLoading(true)
    fetchEvents(range)
    fetchSnapshot()

    // Set up polling for both
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      fetchEvents(range)
      fetchSnapshot()
    }, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [range, fetchEvents, fetchSnapshot])

  const handleRangeChange = (r: DashboardRange) => {
    if (r !== range) {
      setDashboardRange(r)
    }
  }

  // Format "last updated" time
  const lastUpdated = data?.generatedAt
    ? formatTimeAgo(data.generatedAt)
    : null

  return (
    <div style={{ marginBottom: '24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: 600,
              color: 'var(--theme-text)',
            }}
          >
            Dashboard
          </h2>
          {loading && (
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 400,
                color: 'var(--theme-elevation-500)',
              }}
            >
              Loading...
            </span>
          )}
          {!loading && lastUpdated && (
            <span
              style={{
                fontSize: '0.6875rem',
                color: 'var(--theme-elevation-400)',
              }}
            >
              Updated {lastUpdated}
            </span>
          )}
          {error && (
            <span
              style={{
                fontSize: '0.6875rem',
                color: '#ef4444',
              }}
            >
              Error: {error}
            </span>
          )}
        </div>

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
    </div>
  )
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}
