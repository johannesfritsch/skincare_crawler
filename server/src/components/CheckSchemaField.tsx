'use client'

import { useField } from '@payloadcms/ui'
import { useState, useCallback } from 'react'
import type { JSONFieldClientComponent } from 'payload'
import { generateCheckSchema, fetchExampleRecord } from '@/actions/test-suite-actions'

/**
 * Custom Field component for the checkSchema JSON field in TestSuites.
 * Wraps a JSON textarea with an AI-powered "Generate Schema" feature.
 * Detects the phase (searches/discoveries/crawls/aggregations) from the field path.
 */
const CheckSchemaField: JSONFieldClientComponent = ({ field, path }) => {
  const { value, setValue } = useField<Record<string, unknown> | null>({ path: path ?? field.name ?? 'checkSchema' })
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [schemaText, setSchemaText] = useState(() => value ? JSON.stringify(value, null, 2) : '')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [exampleExpanded, setExampleExpanded] = useState(false)
  const [exampleJson, setExampleJson] = useState<string | null>(null)
  const [exampleLoading, setExampleLoading] = useState(false)
  const [exampleError, setExampleError] = useState<string | null>(null)

  // Detect phase from the field path (e.g. "searches.0.checkSchema" → "searches")
  const phase = (path ?? '').split('.')[0] || 'aggregations'

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    setError(null)
    try {
      const result = await generateCheckSchema(phase, prompt.trim(), value)
      if (result.success && result.schema) {
        setValue(result.schema)
        setSchemaText(JSON.stringify(result.schema, null, 2))
        setJsonError(null)
        setPrompt('')
        setExpanded(false)
      } else {
        setError(result.error || 'Unknown error')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate schema')
    } finally {
      setGenerating(false)
    }
  }, [phase, prompt, setValue])

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-elevation-800)' }}>
          {typeof field.label === 'string' ? field.label : 'Check Schema'}
        </label>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            fontSize: '12px', color: 'var(--theme-elevation-500)',
            background: 'none', border: 'none', cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'Hide AI Assistant' : value ? 'Edit with AI' : 'Generate with AI'}
        </button>
      </div>

      {field.admin?.description && (
        <div style={{ fontSize: '12px', color: 'var(--theme-elevation-400)', marginBottom: '6px' }}>
          {field.admin.description as string}
        </div>
      )}

      {expanded && (
        <div style={{
          padding: '10px 12px', marginBottom: '8px',
          background: 'var(--theme-elevation-50)',
          border: '1px solid var(--theme-elevation-150)',
          borderRadius: '6px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--theme-elevation-600)' }}>
            {value ? `Add constraints to the existing schema (${phase})` : `Describe what you want to validate (${phase})`}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`e.g. "Ensure the product has a name, at least one image, and a non-empty description with at least 50 characters"`}
            rows={3}
            style={{
              width: '100%', padding: '8px', fontSize: '13px',
              border: '1px solid var(--theme-elevation-200)',
              borderRadius: '4px', resize: 'vertical',
              fontFamily: 'inherit',
              background: 'var(--theme-input-bg, white)',
              color: 'var(--theme-elevation-800)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              style={{
                padding: '6px 14px', fontSize: '13px', fontWeight: 600,
                borderRadius: '4px', border: 'none', cursor: 'pointer',
                background: generating ? 'var(--theme-elevation-200)' : 'var(--theme-elevation-800)',
                color: generating ? 'var(--theme-elevation-400)' : 'white',
                opacity: !prompt.trim() ? 0.5 : 1,
              }}
            >
              {generating ? 'Generating...' : value ? 'Add to Schema' : 'Generate Schema'}
            </button>
            {error && (
              <span style={{ fontSize: '12px', color: 'var(--theme-error-500)' }}>
                {error}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Example object (fetched from real data) */}
      <div style={{ marginBottom: '8px' }}>
        <button
          type="button"
          disabled={exampleLoading}
          onClick={async () => {
            if (exampleExpanded) {
              setExampleExpanded(false)
              return
            }
            if (exampleJson !== null) {
              setExampleExpanded(true)
              return
            }
            setExampleLoading(true)
            setExampleError(null)
            try {
              const result = await fetchExampleRecord(phase)
              if (result.success && result.record) {
                setExampleJson(JSON.stringify(result.record, null, 2))
                setExampleExpanded(true)
              } else {
                setExampleError(result.error || 'No example found')
                setExampleExpanded(true)
              }
            } catch (e) {
              setExampleError(e instanceof Error ? e.message : 'Failed to fetch example')
              setExampleExpanded(true)
            } finally {
              setExampleLoading(false)
            }
          }}
          style={{
            fontSize: '12px', color: 'var(--theme-elevation-500)',
            background: 'none', border: 'none', cursor: 'pointer',
            textDecoration: 'underline', padding: 0,
            opacity: exampleLoading ? 0.5 : 1,
          }}
        >
          {exampleLoading ? 'Loading...' : exampleExpanded ? 'Hide example object' : 'Show example object'}
        </button>
        {exampleExpanded && (
          <div style={{ marginTop: '6px' }}>
            {exampleError && !exampleJson && (
              <div style={{ fontSize: '12px', color: 'var(--theme-warning-500, #d97706)', padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px' }}>
                {exampleError}
              </div>
            )}
            {exampleJson !== null && (
              <>
                <div style={{ fontSize: '11px', color: 'var(--theme-elevation-400)', marginBottom: '4px' }}>
                  Real {phase} record from the database — edit freely to explore the structure
                </div>
                <pre style={{
                  width: '100%', padding: '8px',
                  fontFamily: 'monospace', fontSize: '11px',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: '4px', overflow: 'auto',
                  background: 'var(--theme-elevation-50)',
                  color: 'var(--theme-elevation-600)',
                  lineHeight: 1.5, margin: 0,
                  maxHeight: '400px', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>{exampleJson}</pre>
              </>
            )}
          </div>
        )}
      </div>

      <textarea
        value={schemaText}
        onChange={(e) => {
          const text = e.target.value
          setSchemaText(text)
          const trimmed = text.trim()
          if (!trimmed) {
            setValue(null as any)
            setJsonError(null)
            return
          }
          try {
            setValue(JSON.parse(trimmed))
            setJsonError(null)
          } catch {
            setJsonError('Invalid JSON')
          }
        }}
        rows={schemaText ? Math.min(Math.max(schemaText.split('\n').length + 1, 4), 20) : 4}
        spellCheck={false}
        style={{
          width: '100%', padding: '8px',
          fontFamily: 'monospace', fontSize: '12px',
          border: `1px solid ${jsonError ? 'var(--theme-error-500)' : 'var(--theme-elevation-200)'}`,
          borderRadius: '4px', resize: 'vertical',
          background: 'var(--theme-input-bg, white)',
          color: 'var(--theme-elevation-800)',
          lineHeight: 1.5,
        }}
        placeholder="JSON Schema (draft-07) — or use the AI assistant above"
      />
      {jsonError && (
        <div style={{ fontSize: '11px', color: 'var(--theme-error-500)', marginTop: '2px' }}>{jsonError}</div>
      )}
    </div>
  )
}

export default CheckSchemaField
