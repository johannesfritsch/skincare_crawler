'use client'

import { useFormFields } from '@payloadcms/ui'

const PHASE_ORDER = ['searches', 'discoveries', 'crawls', 'aggregations'] as const
const PHASE_LABELS: Record<string, string> = {
  searches: 'Searches',
  discoveries: 'Discoveries',
  crawls: 'Crawls',
  aggregations: 'Aggregations',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--theme-elevation-400)',
  running: 'var(--theme-warning-500)',
  validating: '#6366f1',
  passed: 'var(--theme-success-500)',
  failed: 'var(--theme-error-500)',
  skipped: 'var(--theme-elevation-300)',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  validating: 'Validating',
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
}

export default function TestSuitePhaseStatus() {
  const phasesRaw = useFormFields(([fields]) => fields.phases?.value)

  if (!phasesRaw) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '14px' }}>
        No phase data yet. Start a run to see progress.
      </div>
    )
  }

  let phases: Record<string, { status: string; jobIds: number[]; validationResults?: Array<{ entryIndex: number; passed: boolean; errors?: string[] }> }>
  try {
    phases = typeof phasesRaw === 'string' ? JSON.parse(phasesRaw) : phasesRaw as any
  } catch {
    return null
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '12px' }}>
        {PHASE_ORDER.map((phase, i) => {
          const state = phases[phase]
          if (!state) return null
          const color = STATUS_COLORS[state.status] || 'var(--theme-elevation-400)'

          return (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {i > 0 && (
                <div style={{ width: '24px', height: '2px', background: 'var(--theme-elevation-200)' }} />
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', borderRadius: '6px',
                background: 'var(--theme-elevation-50)',
                border: `2px solid ${color}`,
              }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  backgroundColor: color,
                }} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {PHASE_LABELS[phase]}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--theme-elevation-500)' }}>
                  {STATUS_LABELS[state.status]}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Show validation errors for failed phases */}
      {PHASE_ORDER.map((phase) => {
        const state = phases[phase]
        if (!state || state.status !== 'failed' || !state.validationResults?.length) return null
        const failed = state.validationResults.filter(r => !r.passed)
        if (failed.length === 0) return null

        return (
          <div key={`${phase}-errors`} style={{
            margin: '8px 0', padding: '10px 14px',
            background: 'var(--theme-error-50)',
            border: '1px solid var(--theme-error-200)',
            borderRadius: '6px', fontSize: '13px',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--theme-error-500)' }}>
              {PHASE_LABELS[phase]} — Validation Failed
            </div>
            {failed.map((r, i) => (
              <div key={i} style={{ color: 'var(--theme-elevation-600)', marginTop: '2px' }}>
                Entry {r.entryIndex}: {r.errors?.join('; ') || 'Unknown error'}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
