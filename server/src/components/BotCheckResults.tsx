'use client'

import { useFormFields } from '@payloadcms/ui'

interface TestResult {
  name: string
  value: string | boolean | number
  passed: boolean
}

export default function BotCheckResults() {
  const resultJson = useFormFields(([fields]) => fields.resultJson?.value)

  if (!resultJson) {
    return (
      <div style={{
        padding: '16px',
        margin: '16px 0',
        background: 'var(--theme-elevation-50)',
        borderRadius: 'var(--border-radius-m)',
        color: 'var(--theme-elevation-500)',
        textAlign: 'center',
      }}>
        No bot check results yet. Create and run this job to see results.
      </div>
    )
  }

  let results: TestResult[] = []
  let summary = { passed: 0, failed: 0, total: 0 }

  try {
    const data = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson
    results = data.tests || []
    summary = { passed: data.passed || 0, failed: data.failed || 0, total: data.total || 0 }
  } catch {
    return (
      <div style={{ padding: '16px', margin: '16px 0', color: 'var(--theme-error-500)' }}>
        Failed to parse results JSON.
      </div>
    )
  }

  const allPassed = summary.failed === 0 && summary.total > 0

  return (
    <div style={{ margin: '16px 0' }}>
      {/* Summary header */}
      <div style={{
        padding: '12px 16px',
        borderRadius: 'var(--border-radius-m) var(--border-radius-m) 0 0',
        background: allPassed ? '#065f46' : '#991b1b',
        color: '#fff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontWeight: 600,
      }}>
        <span>{allPassed ? 'All checks passed' : `${summary.failed} check${summary.failed !== 1 ? 's' : ''} failed`}</span>
        <span style={{ fontSize: '14px', fontWeight: 400, opacity: 0.9 }}>
          {summary.passed}/{summary.total} passed
        </span>
      </div>

      {/* Test rows */}
      <div style={{
        border: '1px solid var(--theme-elevation-150)',
        borderTop: 'none',
        borderRadius: '0 0 var(--border-radius-m) var(--border-radius-m)',
        overflow: 'hidden',
      }}>
        {results.map((test, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 16px',
              borderBottom: i < results.length - 1 ? '1px solid var(--theme-elevation-100)' : 'none',
              background: 'var(--theme-elevation-0)',
            }}
          >
            <span style={{
              fontSize: '18px',
              lineHeight: 1,
              flexShrink: 0,
              width: '24px',
              textAlign: 'center',
            }}>
              {test.passed ? '\u2705' : '\u274C'}
            </span>
            <span style={{ flex: 1, fontWeight: 500 }}>{test.name}</span>
            <span style={{
              fontSize: '13px',
              color: 'var(--theme-elevation-500)',
              maxWidth: '300px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {String(test.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
