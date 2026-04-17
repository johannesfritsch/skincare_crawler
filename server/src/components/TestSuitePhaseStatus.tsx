'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState, useCallback } from 'react'

const PHASE_ORDER = ['searches', 'discoveries', 'crawls', 'aggregations', 'videoDiscoveries', 'videoCrawls', 'videoProcessings'] as const
const PHASE_LABELS: Record<string, string> = {
  searches: 'Product Searches',
  discoveries: 'Product Discoveries',
  crawls: 'Product Crawls',
  aggregations: 'Product Aggregations',
  videoDiscoveries: 'Video Discoveries',
  videoCrawls: 'Video Crawls',
  videoProcessings: 'Video Processing',
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

interface TestResult {
  phase: string
  entryIndex: number
  identifier: string
  passed: boolean
  checkSchema?: Record<string, unknown>
  record?: Record<string, unknown>
  schemaErrors?: string[]
  aiCheckResults?: AiCheckResults
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
  results?: TestResult[]
  failureReason?: string
}

function AiCheckDisplay({ entryIndex, ai }: { entryIndex: number; ai: AiCheckResults }) {
  const scorePercent = (ai.score * 100).toFixed(0)
  const thresholdPercent = (ai.threshold * 100).toFixed(0)
  const yesCount = ai.results.filter(r => r.answer).length

  return (
    <div style={{ marginTop: '6px', padding: '8px 10px', background: 'var(--theme-elevation-100)', borderRadius: '4px', border: '1px solid var(--theme-elevation-200)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--theme-elevation-800)' }}>Entry {entryIndex} — AI Checks:</span>
        <span style={{
          fontWeight: 700, fontSize: '12px',
          color: ai.passed ? 'var(--theme-success-500)' : 'var(--theme-error-500)',
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
          <span style={{ color: r.answer ? 'var(--theme-success-500)' : 'var(--theme-error-500)', fontWeight: 700, flexShrink: 0 }}>
            {r.answer ? '\u2713' : '\u2717'}
          </span>
          <span>
            <strong style={{ color: 'var(--theme-elevation-800)' }}>{r.question}</strong>
            {r.reasoning && (
              <span style={{ color: 'var(--theme-elevation-500)', marginLeft: '6px' }}>— {r.reasoning}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function ResultItem({ result }: { result: TestResult }) {
  const [showRecord, setShowRecord] = useState(false)
  const [showSchema, setShowSchema] = useState(false)

  return (
    <div style={{
      marginBottom: '12px', padding: '12px',
      border: '1px solid var(--theme-elevation-200)',
      borderRadius: '6px', background: 'var(--theme-elevation-50)',
    }}>
      {/* Header: identifier + pass/fail */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{
          fontWeight: 700, fontSize: '13px',
          color: result.passed ? 'var(--theme-success-500)' : 'var(--theme-error-500)',
        }}>
          {result.passed ? '\u2713' : '\u2717'}
        </span>
        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--theme-elevation-800)' }}>
          {result.identifier}
        </span>
      </div>

      {/* Schema check */}
      {result.checkSchema && (
        <div style={{ marginBottom: '8px', padding: '8px 10px', background: 'var(--theme-elevation-100)', borderRadius: '4px', border: '1px solid var(--theme-elevation-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontWeight: 700, fontSize: '12px',
              color: (!result.schemaErrors || result.schemaErrors.length === 0) ? 'var(--theme-success-500)' : 'var(--theme-error-500)',
            }}>
              {(!result.schemaErrors || result.schemaErrors.length === 0) ? '\u2713' : '\u2717'}
            </span>
            <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--theme-elevation-800)' }}>
              Schema Check
            </span>
            <span style={{ fontSize: '12px', color: (!result.schemaErrors || result.schemaErrors.length === 0) ? 'var(--theme-success-500)' : 'var(--theme-error-500)' }}>
              {(!result.schemaErrors || result.schemaErrors.length === 0) ? 'Passed' : `Failed (${result.schemaErrors.length} error${result.schemaErrors.length !== 1 ? 's' : ''})`}
            </span>
          </div>
          {result.schemaErrors && result.schemaErrors.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {result.schemaErrors.map((err, j) => (
                <div key={j} style={{ fontSize: '12px', color: 'var(--theme-elevation-600)', marginTop: '2px', paddingLeft: '22px' }}>{err}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Checks */}
      {result.aiCheckResults && (
        <AiCheckDisplay entryIndex={result.entryIndex} ai={result.aiCheckResults} />
      )}

      {/* Toggle buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
        {result.record && (
          <button onClick={() => setShowRecord(!showRecord)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '12px', color: 'var(--theme-elevation-500)', textDecoration: 'underline', padding: 0,
          }}>
            {showRecord ? 'Hide record' : 'Show record'}
          </button>
        )}
        {result.checkSchema && (
          <button onClick={() => setShowSchema(!showSchema)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '12px', color: 'var(--theme-elevation-500)', textDecoration: 'underline', padding: 0,
          }}>
            {showSchema ? 'Hide schema' : 'Show schema'}
          </button>
        )}
      </div>

      {/* Record JSON */}
      {showRecord && result.record && (
        <pre style={{
          marginTop: '8px', padding: '8px', fontSize: '11px',
          background: 'var(--theme-elevation-100)', borderRadius: '4px',
          overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', color: 'var(--theme-elevation-600)', margin: '8px 0 0',
        }}>{JSON.stringify(result.record, null, 2)}</pre>
      )}

      {/* Schema JSON */}
      {showSchema && result.checkSchema && (
        <pre style={{
          marginTop: '8px', padding: '8px', fontSize: '11px',
          background: 'var(--theme-elevation-100)', borderRadius: '4px',
          overflow: 'auto', maxHeight: '300px', whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', color: 'var(--theme-elevation-600)', margin: '8px 0 0',
        }}>{JSON.stringify(result.checkSchema, null, 2)}</pre>
      )}
    </div>
  )
}

export default function TestSuitePhaseStatus() {
  const { id } = useDocumentInfo()
  const [data, setData] = useState<RunData | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalPhase, setModalPhase] = useState<string | null>(null)

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
          results: doc.results,
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
        <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', background: 'var(--theme-elevation-100)', color: 'var(--theme-success-500)', fontWeight: 600, fontSize: '14px' }}>
          {'\u2713'} All checks passed
        </div>
      )}
      {!isActive && data.status === 'failed' && (
        <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', background: 'var(--theme-elevation-100)', color: 'var(--theme-error-500)', fontWeight: 600, fontSize: '14px' }}>
          {'\u2717'} Run failed{data.failureReason ? `: ${data.failureReason.slice(0, 100)}` : ''}
        </div>
      )}
      {isActive && (
        <div style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '6px', background: 'var(--theme-elevation-100)', color: 'var(--theme-warning-500)', fontWeight: 600, fontSize: '14px' }}>
          {'\u25B6'} Running{data.currentPhase !== 'pending' ? ` — ${PHASE_LABELS[data.currentPhase] || data.currentPhase}` : ''}...
        </div>
      )}

      {/* Phase timelines — split into Product and Video rows */}
      {[
        { label: 'Products', phases: ['searches', 'discoveries', 'crawls', 'aggregations'] as const },
        { label: 'Videos', phases: ['videoDiscoveries', 'videoCrawls', 'videoProcessings'] as const },
      ].map(({ label, phases: groupPhases }) => {
        const hasAny = groupPhases.some(p => phases[p] && phases[p].status !== 'skipped')
        if (!hasAny) return null
        return (
          <div key={label} style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--theme-elevation-400)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {groupPhases.map((phase, i) => {
                const state = phases[phase]
                if (!state) return null
                const color = STATUS_COLORS[state.status] || 'var(--theme-elevation-400)'
                const hasResults = data.results && data.results.some(r => r.phase === phase)
                return (
                  <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {i > 0 && (
                      <div style={{ width: '12px', height: '2px', background: 'var(--theme-elevation-200)' }} />
                    )}
                    <div
                      onClick={hasResults ? () => setModalPhase(phase) : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '5px 8px', borderRadius: '6px',
                        background: 'var(--theme-elevation-50)',
                        border: `2px solid ${color}`,
                        cursor: hasResults ? 'pointer' : 'default',
                      }}
                    >
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
          </div>
        )
      })}

      {/* Modal */}
      {modalPhase && data?.results && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            padding: '40px 20px', overflowY: 'auto',
          }}
          onClick={() => setModalPhase(null)}
        >
          <div
            style={{
              background: 'var(--theme-elevation-0)', borderRadius: '8px',
              maxWidth: '900px', width: '100%', maxHeight: 'calc(100vh - 80px)',
              overflowY: 'auto', padding: '20px',
              border: '1px solid var(--theme-elevation-200)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--theme-elevation-800)' }}>
                {PHASE_LABELS[modalPhase] || modalPhase}
              </h3>
              <button
                onClick={() => setModalPhase(null)}
                style={{
                  background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer',
                  color: 'var(--theme-elevation-500)', padding: '4px 8px',
                }}
              >
                {'\u2715'}
              </button>
            </div>

            {/* Results for this phase */}
            {data.results
              .filter(r => r.phase === modalPhase)
              .map((r, i) => (
                <ResultItem key={i} result={r} />
              ))
            }

            {data.results.filter(r => r.phase === modalPhase).length === 0 && (
              <div style={{ color: 'var(--theme-elevation-400)', fontSize: '13px' }}>No results for this phase.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
