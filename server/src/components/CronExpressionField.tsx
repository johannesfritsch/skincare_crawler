'use client'

import type { TextFieldClientComponent } from 'payload'
import { FieldLabel, TextInput, useField } from '@payloadcms/ui'
import { Cron } from 'croner'
import React, { type ChangeEvent } from 'react'

// ── Presets ──────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Every 6h', value: '0 */6 * * *' },
  { label: 'Daily 6am', value: '0 6 * * *' },
  { label: 'Daily midnight', value: '0 0 * * *' },
  { label: 'Weekly Mon', value: '0 6 * * 1' },
  { label: 'Monthly 1st', value: '0 6 1 * *' },
] as const

// ── Human-readable description ────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'Custom schedule'

  const [min, hour, dom, , dow] = parts

  // Every hour: 0 * * * *
  if (min === '0' && hour === '*' && dom === '*' && dow === '*') {
    return 'Every hour'
  }

  // Every N hours: 0 */N * * *
  const everyNHoursMatch = hour.match(/^\*\/(\d+)$/)
  if (min === '0' && everyNHoursMatch && dom === '*' && dow === '*') {
    const n = parseInt(everyNHoursMatch[1], 10)
    return `Every ${n} hours`
  }

  // Daily at HH:MM: M H * * *
  const isNumericMin = /^\d+$/.test(min)
  const isNumericHour = /^\d+$/.test(hour)
  if (isNumericMin && isNumericHour && dom === '*' && dow === '*') {
    return `Daily at ${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))}`
  }

  // Weekly on [dayname] at HH:MM: M H * * D
  const isNumericDow = /^\d$/.test(dow)
  if (isNumericMin && isNumericHour && dom === '*' && isNumericDow) {
    const dayIndex = parseInt(dow, 10)
    const dayName = DAY_NAMES[dayIndex] ?? `day ${dayIndex}`
    return `Weekly on ${dayName} at ${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))}`
  }

  // Monthly on day D at HH:MM: M H D * *
  const isNumericDom = /^\d+$/.test(dom)
  if (isNumericMin && isNumericHour && isNumericDom && dow === '*') {
    return `Monthly on day ${dom} at ${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))}`
  }

  return 'Custom schedule'
}

// ── Component ─────────────────────────────────────────────────────────────────

const CronExpressionField: TextFieldClientComponent = ({ field, path }) => {
  const { value, setValue } = useField<string>({ path })

  // Parse and compute next run times
  let description: string | null = null
  let nextRuns: string[] = []
  let parseError: string | null = null

  if (value && value.trim()) {
    try {
      const job = new Cron(value.trim(), { timezone: 'UTC' })
      description = describeCron(value.trim())

      const runs: string[] = []
      let cursor: Date | null = new Date()
      for (let i = 0; i < 3; i++) {
        cursor = job.nextRun(cursor)
        if (!cursor) break
        runs.push(cursor.toLocaleString() + ' (local) / ' + cursor.toISOString().replace('T', ' ').slice(0, 16) + ' UTC')
        // Advance by 1ms so nextRun doesn't return the same date
        cursor = new Date(cursor.getTime() + 1)
      }

      if (runs.length === 0) {
        nextRuns = []
        description = description + ' (no future runs)'
      } else {
        nextRuns = runs
      }
    } catch (err: unknown) {
      parseError = err instanceof Error ? err.message : 'Invalid cron expression'
    }
  }

  const pillStyle: React.CSSProperties = {
    padding: '4px 10px',
    fontSize: '12px',
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: '12px',
    background: 'var(--theme-elevation-50)',
    cursor: 'pointer',
  }

  return (
    <div style={{ marginBottom: 'var(--spacing-field)' }}>
      <FieldLabel label={field.label} path={path} />

      {/* Preset buttons */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          marginBottom: '8px',
        }}
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setValue(preset.value)}
            style={{
              ...pillStyle,
              background:
                value === preset.value
                  ? 'var(--theme-elevation-200)'
                  : 'var(--theme-elevation-50)',
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Text input */}
      <TextInput
        path={path}
        value={value ?? ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        label=""
        showError={false}
      />

      {/* Preview */}
      {value && value.trim() && (
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            borderRadius: 'var(--style-radius-s)',
            padding: '10px 12px',
            marginTop: '8px',
            fontSize: '13px',
          }}
        >
          {parseError ? (
            <span style={{ color: 'var(--theme-error-500)' }}>{parseError}</span>
          ) : (
            <>
              <div style={{ marginBottom: nextRuns.length > 0 ? '6px' : 0 }}>
                {description}
              </div>
              {nextRuns.length > 0 && (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    color: 'var(--theme-elevation-500)',
                    fontSize: '12px',
                  }}
                >
                  {nextRuns.map((run, i) => (
                    <li key={i}>{run}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* Clear button */}
      {value && value.trim() && (
        <div style={{ marginTop: '6px' }}>
          <button
            type="button"
            onClick={() => setValue('')}
            style={{
              ...pillStyle,
              color: 'var(--theme-error-500)',
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

export default CronExpressionField
