'use client'

import { useEffect, useState } from 'react'

const STATUS_ICON: Record<string, string> = {
  completed: '\u2713',
  failed: '\u2717',
  in_progress: '\u25B6',
  pending: '\u25CB',
  scheduled: '\u25CB',
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#059669',
  failed: 'var(--theme-error-500)',
  in_progress: 'var(--theme-warning-500)',
  pending: 'var(--theme-elevation-400)',
  scheduled: 'var(--theme-elevation-400)',
}

export default function TestSuiteRunsCell({ rowData }: { rowData: Record<string, unknown> }) {
  const [runs, setRuns] = useState<Array<{ id: number; status: string }> | null>(null)
  const suiteId = rowData.id

  useEffect(() => {
    if (!suiteId) return
    fetch(`/api/test-suite-runs?where[testSuite][equals]=${suiteId}&limit=5&sort=-createdAt&depth=0&select[status]=true`)
      .then(r => r.json())
      .then(data => setRuns(data.docs ?? []))
      .catch(() => setRuns([]))
  }, [suiteId])

  if (runs === null) {
    return <span style={{ color: 'var(--theme-elevation-300)', fontSize: '12px' }}>...</span>
  }

  if (runs.length === 0) {
    return <span style={{ color: 'var(--theme-elevation-300)', fontSize: '12px' }}>\u2014</span>
  }

  return (
    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
      {runs.map((run) => (
        <span
          key={run.id}
          title={`Run #${run.id}: ${run.status}`}
          style={{
            fontSize: '14px',
            fontWeight: 700,
            lineHeight: 1,
            color: STATUS_COLOR[run.status] || 'var(--theme-elevation-400)',
          }}
        >
          {STATUS_ICON[run.status] || '\u25CB'}
        </span>
      ))}
    </span>
  )
}
