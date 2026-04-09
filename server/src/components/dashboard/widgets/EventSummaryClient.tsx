'use client'

import { useDashboardState } from '../dashboard-store'
import { WidgetContainer } from './WidgetContainer'

interface StatCardProps {
  label: string
  value: number
  color?: string
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: '120px',
        padding: '16px',
        backgroundColor: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-150)',
      }}
    >
      <div
        style={{
          fontSize: '0.75rem',
          fontWeight: 500,
          color: 'var(--theme-elevation-500)',
          marginBottom: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          color: color ?? 'var(--theme-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  )
}

export default function EventSummaryClient() {
  const { data } = useDashboardState()

  if (!data) return null

  const { summary } = data

  return (
    <WidgetContainer>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <StatCard label="Total Events" value={summary.totalEvents} />
        <StatCard label="Errors" value={summary.errors} color="#ef4444" />
        <StatCard label="Warnings" value={summary.warnings} color="#f59e0b" />
        <StatCard label="Jobs Started" value={summary.jobsStarted} color="#3b82f6" />
        <StatCard label="Jobs Completed" value={summary.jobsCompleted} color="#22c55e" />
        <StatCard label="Jobs Failed" value={summary.jobsFailed} color="#ef4444" />
      </div>
    </WidgetContainer>
  )
}
