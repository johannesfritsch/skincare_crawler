'use client'

import { useDocumentInfo, useConfig } from '@payloadcms/ui'
import { useEffect, useState, useCallback } from 'react'

interface PhaseState {
  status: string
}

interface Run {
  id: number
  status: string
  currentPhase: string
  completed: number
  errors: number
  phases: Record<string, PhaseState> | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--theme-elevation-400)',
  scheduled: 'var(--theme-elevation-400)',
  in_progress: 'var(--theme-warning-500)',
  completed: '#059669',
  failed: 'var(--theme-error-500)',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '\u25CB Pending',
  scheduled: '\u25CB Scheduled',
  in_progress: '\u25B6 Running',
  completed: '\u2713 Passed',
  failed: '\u2717 Failed',
}

const PHASE_ORDER = ['searches', 'discoveries', 'crawls', 'aggregations'] as const
const PHASE_ICONS: Record<string, string> = {
  searches: 'S',
  discoveries: 'D',
  crawls: 'C',
  aggregations: 'A',
}

const PHASE_STATUS_COLORS: Record<string, string> = {
  pending: 'var(--theme-elevation-300)',
  running: 'var(--theme-warning-500)',
  passed: 'var(--theme-success-500)',
  failed: 'var(--theme-error-500)',
  skipped: 'var(--theme-elevation-200)',
}

function PhaseIndicators({ phases }: { phases: Record<string, PhaseState> | null }) {
  if (!phases) return <span style={{ color: 'var(--theme-elevation-300)' }}>--</span>

  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
      {PHASE_ORDER.map((phase) => {
        const state = phases[phase]
        if (!state) return null
        const s = state.status

        // Icon per status
        let icon: string
        let bg: string
        let fg: string
        let border: string | undefined

        if (s === 'passed') {
          icon = '\u2713' // checkmark
          bg = '#059669'
          fg = '#fff'
        } else if (s === 'failed') {
          icon = '\u2717' // x mark
          bg = 'var(--theme-error-500)'
          fg = '#fff'
        } else if (s === 'running') {
          icon = '\u25B6' // play triangle
          bg = 'var(--theme-warning-500)'
          fg = '#fff'
        } else if (s === 'skipped') {
          icon = '\u2014' // em dash
          bg = 'transparent'
          fg = 'var(--theme-elevation-300)'
          border = '1px solid var(--theme-elevation-200)'
        } else {
          // pending
          icon = '\u25CB' // circle outline
          bg = 'var(--theme-elevation-100)'
          fg = 'var(--theme-elevation-400)'
        }

        return (
          <span
            key={phase}
            title={`${phase}: ${state.status}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              borderRadius: '3px',
              fontSize: s === 'passed' || s === 'failed' ? '12px' : '9px',
              fontWeight: 700,
              lineHeight: 1,
              backgroundColor: bg,
              color: fg,
              border: border ?? 'none',
            }}
          >
            {icon}
          </span>
        )
      })}
    </span>
  )
}

function countPhases(phases: Record<string, PhaseState> | null, status: string): number {
  if (!phases) return 0
  return Object.values(phases).filter(p => p.status === status).length
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '--'
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '--'
  }
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
        `/api/test-suite-runs?where[testSuite][equals]=${id}&limit=5&sort=-createdAt&depth=0`,
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
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>Phases</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>OK</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>Err</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--theme-elevation-450)', fontWeight: 500 }}>When</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const color = STATUS_COLORS[run.status] || 'var(--theme-elevation-400)'
            const label = STATUS_LABELS[run.status] || run.status
            return (
              <tr
                key={run.id}
                onClick={() => { window.location.href = `${adminRoute}/collections/test-suite-runs/${run.id}` }}
                style={{ borderBottom: '1px solid var(--theme-elevation-100)', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--theme-elevation-50)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <td style={{ padding: '6px 8px', color }}>
                  {label}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <PhaseIndicators phases={run.phases} />
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{countPhases(run.phases, 'passed')}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: countPhases(run.phases, 'failed') > 0 ? 'var(--theme-error-500)' : undefined }}>{countPhases(run.phases, 'failed')}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--theme-elevation-500)' }}>{formatTime(run.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
