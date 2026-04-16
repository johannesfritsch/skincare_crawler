'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState, useCallback } from 'react'

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
  passed: '#059669',
  failed: 'var(--theme-error-500)',
  skipped: 'var(--theme-elevation-300)',
}

const STATUS_ICONS: Record<string, string> = {
  pending: '\u25CB',
  running: '\u25B6',
  validating: '\u2026',
  passed: '\u2713',
  failed: '\u2717',
  skipped: '\u2014',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  validating: 'Validating',
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
}

interface AiCheckResultItem {
  question: string
  answer: boolean
  reasoning: string
}

interface AiCheckResults {
  score: number
  threshold: number
  passed: boolean
  results: AiCheckResultItem[]
}

interface PhaseData {
  status: string
  jobIds: number[]
  validationResults?: Array<{
    entryIndex: number
    passed: boolean
    errors?: string[]
    aiCheckResults?: AiCheckResults
  }>
}

interface RunData {
  status: string
  currentPhase: string
  phases: Record<string, PhaseData> | null
  failureReason?: string
}

function AiCheckDisplay({ entryIndex, ai }: { entryIndex: number; ai: AiCheckResults }) {
  const scorePercent = (ai.score * 100).toFixed(0)
  const thresholdPercent = (ai.threshold * 100).toFixed(0)
  const yesCount = ai.results.filter(r => r.answer).length

  return (
    <div style={{ marginTop: '6px', padding: '8px 10px', background: 'var(--theme-elevation-50)', borderRadius: '4px', border: '1px solid var(--theme-elevation-150)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontWeight: 600, fontSize: '12px' }}>Entry {entryIndex} — AI Checks:</span>
        <span style={{
          fontWeight: 700, fontSize: '12px',
          color: ai.passed ? '#059669' : 'var(--theme-error-500)',
        }}>
          {yesCount}/{ai.results.length} ({scorePercent}%)
          {' '}{ai.passed ? '\u2713 Passed' : `\u2717 Failed (min ${thresholdPercent}%)`}
        </span>
      </div>
      {ai.results.map((r, j) => (
        <div key={j} style={{
          display: 'flex', gap: '6px', marginTop: '3px', fontSize: '12px',
          color: 'var(--theme-elevation-600)',
        }}>
          <span style={{ color: r.answer ? '#059669' : 'var(--theme-error-500)', fontWeight: 700, flexShrink: 0 }}>
            {r.answer ? '\u2713' : '\u2717'}
          </span>
          <span>
            <strong>{r.question}</strong>
            {r.reasoning && (
              <span style={{ color: 'var(--theme-elevation-400)', marginLeft: '6px' }}>— {r.reasoning}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function TestSuitePhaseStatus() {
  const { id } = useDocumentInfo()
  const [data, setData] = useState<RunData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!id) { setLoading(false); return }
    try {
      const res = await fetch(`/api/test-suite-runs/${id}?depth=0`)
      if (res.ok) {
        const doc = await res.json()
        setData({
          status: doc.status,
          currentPhase: doc.currentPhase,
          phases: doc.phases,
          failureReason: doc.failureReason,
        })
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchData()
    // Poll while running
    const interval = setInterval(() => {
      if (data?.status === 'in_progress' || data?.status === 'pending') {
        fetchData()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [fetchData, data?.status])

  if (loading || !data) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '14px' }}>Loading...</div>
  }

  const phases = data.phases
  if (!phases) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '14px' }}>No phase data yet. Waiting for worker to claim this run.</div>
  }

  const isActive = data.status === 'in_progress' || data.status === 'pending'

  return (
    <div style={{ margin: '12px 0' }}>
      {/* Overall status */}
      {!isActive && data.status === 'completed' && (
        <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', background: '#ecfdf5', color: '#059669', fontWeight: 600, fontSize: '14px' }}>
          {'\u2713'} All checks passed
        </div>
      )}
      {!isActive && data.status === 'failed' && (
        <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', background: 'var(--theme-error-50, #fef2f2)', color: 'var(--theme-error-500)', fontWeight: 600, fontSize: '14px' }}>
          {'\u2717'} Run failed{data.failureReason ? `: ${data.failureReason.slice(0, 100)}` : ''}
        </div>
      )}
      {isActive && (
        <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', background: '#fffbeb', color: 'var(--theme-warning-500)', fontWeight: 600, fontSize: '14px' }}>
          {'\u25B6'} Running{data.currentPhase !== 'pending' ? ` — ${PHASE_LABELS[data.currentPhase] || data.currentPhase}` : ''}...
        </div>
      )}

      {/* Phase timeline */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '12px', flexWrap: 'nowrap', overflowX: 'auto' }}>
        {PHASE_ORDER.map((phase, i) => {
          const state = phases[phase]
          if (!state) return null
          const color = STATUS_COLORS[state.status] || 'var(--theme-elevation-400)'

          return (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {i > 0 && (
                <div style={{ width: '12px', height: '2px', background: 'var(--theme-elevation-200)' }} />
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 8px', borderRadius: '6px',
                background: 'var(--theme-elevation-50)',
                border: `2px solid ${color}`,
              }}>
                <span style={{ fontSize: '14px', lineHeight: 1, color, fontWeight: 700 }}>
                  {STATUS_ICONS[state.status] || '\u25CB'}
                </span>
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

      {/* Validation errors + AI check results for failed phases */}
      {PHASE_ORDER.map((phase) => {
        const state = phases[phase]
        if (!state || state.status !== 'failed' || !state.validationResults?.length) return null
        const failed = state.validationResults.filter(r => !r.passed)
        if (failed.length === 0) return null

        return (
          <div key={`${phase}-errors`} style={{
            margin: '8px 0', padding: '10px 14px',
            background: 'var(--theme-error-50, #fef2f2)',
            border: '1px solid var(--theme-error-200, #fecaca)',
            borderRadius: '6px', fontSize: '13px',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--theme-error-500)' }}>
              {PHASE_LABELS[phase]} — Validation Failed
            </div>
            {failed.map((r, i) => (
              <div key={i} style={{ marginTop: '6px' }}>
                {r.errors && r.errors.length > 0 && (
                  <div style={{ color: 'var(--theme-elevation-600)', marginTop: '2px' }}>
                    Entry {r.entryIndex}: {r.errors.join('; ')}
                  </div>
                )}
                {r.aiCheckResults && (
                  <AiCheckDisplay entryIndex={r.entryIndex} ai={r.aiCheckResults} />
                )}
              </div>
            ))}
          </div>
        )
      })}

      {/* AI check results for passed phases */}
      {PHASE_ORDER.map((phase) => {
        const state = phases[phase]
        if (!state || state.status !== 'passed' || !state.validationResults?.length) return null
        const withAi = state.validationResults.filter(r => r.aiCheckResults)
        if (withAi.length === 0) return null

        return (
          <div key={`${phase}-ai`} style={{
            margin: '8px 0', padding: '10px 14px',
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '6px', fontSize: '13px',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px', color: '#059669' }}>
              {PHASE_LABELS[phase]} — AI Checks
            </div>
            {withAi.map((r, i) => (
              <AiCheckDisplay key={i} entryIndex={r.entryIndex} ai={r.aiCheckResults!} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
