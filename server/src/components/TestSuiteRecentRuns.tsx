'use client'

import { useDocumentInfo, useConfig } from '@payloadcms/ui'
import { useEffect, useState, useCallback } from 'react'

interface Run {
  id: number
  status: string
  currentPhase: string
  completed: number
  errors: number
  createdAt: string
  completedAt: string | null
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--theme-elevation-400)',
  scheduled: 'var(--theme-elevation-400)',
  in_progress: 'var(--theme-warning-500)',
  completed: 'var(--theme-success-500)',
  failed: 'var(--theme-error-500)',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  in_progress: 'Running',
  completed: 'Passed',
  failed: 'Failed',
}

export default function TestSuiteRecentRuns() {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRuns = useCallback(async () => {
    if (!id) { setLoading(false); return }
    try {
      const res = await fetch(
        `/api/test-suite-runs?where[testSuite][equals]=${id}&limit=5&sort=-createdAt&depth=0` +
        `&select[status]=true&select[currentPhase]=true&select[completed]=true&select[errors]=true&select[completedAt]=true`,
      )
      if (res.ok) {
        const data = await res.json()
        setRuns(data.docs ?? [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  if (!id) return null

  if (loading) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '14px' }}>Loading runs...</div>
  }

  if (runs.length === 0) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '14px' }}>No runs yet. Click "Run" to start one.</div>
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--theme-elevation-600)' }}>
        Recent Runs
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--theme-elevation-150)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>Status</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>Phase</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>OK</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>Err</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>When</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const color = STATUS_COLORS[run.status] || 'var(--theme-elevation-400)'
            const label = STATUS_LABELS[run.status] || run.status
            const time = new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            return (
              <tr
                key={run.id}
                onClick={() => { window.location.href = `${adminRoute}/collections/test-suite-runs/${run.id}` }}
                style={{ borderBottom: '1px solid var(--theme-elevation-100)', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--theme-elevation-50)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                    {label}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--theme-elevation-500)' }}>{run.currentPhase}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{run.completed}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: run.errors > 0 ? 'var(--theme-error-500)' : undefined }}>{run.errors}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--theme-elevation-500)' }}>{time}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
