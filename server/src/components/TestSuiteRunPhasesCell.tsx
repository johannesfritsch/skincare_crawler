'use client'

const PHASE_ORDER = ['searches', 'discoveries', 'crawls', 'aggregations'] as const
const PHASE_ICONS: Record<string, string> = {
  searches: 'S',
  discoveries: 'D',
  crawls: 'C',
  aggregations: 'A',
}

const PHASE_STATUS_COLORS: Record<string, { bg: string; fg: string; border?: string }> = {
  passed: { bg: '#059669', fg: '#fff' },
  failed: { bg: 'var(--theme-error-500)', fg: '#fff' },
  running: { bg: 'var(--theme-warning-500)', fg: '#fff' },
  pending: { bg: 'var(--theme-elevation-100)', fg: 'var(--theme-elevation-400)' },
  skipped: { bg: 'transparent', fg: 'var(--theme-elevation-300)', border: '1px solid var(--theme-elevation-200)' },
}

export default function TestSuiteRunPhasesCell({ rowData }: { rowData: Record<string, unknown> }) {
  const phases = rowData.phases as Record<string, { status: string }> | null

  if (!phases) {
    return <span style={{ color: 'var(--theme-elevation-300)', fontSize: '12px' }}>{'\u2014'}</span>
  }

  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
      {PHASE_ORDER.map((phase) => {
        const state = phases[phase]
        if (!state) return null
        const style = PHASE_STATUS_COLORS[state.status] || PHASE_STATUS_COLORS.pending

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
              fontSize: state.status === 'passed' || state.status === 'failed' ? '12px' : '10px',
              fontWeight: 700,
              lineHeight: 1,
              backgroundColor: style.bg,
              color: style.fg,
              border: style.border ?? 'none',
            }}
          >
            {state.status === 'passed' ? '\u2713' :
             state.status === 'failed' ? '\u2717' :
             state.status === 'running' ? '\u25B6' :
             state.status === 'skipped' ? '\u2014' :
             PHASE_ICONS[phase]}
          </span>
        )
      })}
    </span>
  )
}
