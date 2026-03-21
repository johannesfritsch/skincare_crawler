'use client'

import type { UIFieldClientComponent } from 'payload'
import { Drawer, DrawerToggler, useDrawerSlug, useField, useFormFields, useModal } from '@payloadcms/ui'
import { Cron } from 'croner'
import React, { type ChangeEvent, useState } from 'react'

// ── Presets ───────────────────────────────────────────────────────────────────

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
  if (min === '0' && hour === '*' && dom === '*' && dow === '*') return 'Every hour'
  const everyNHoursMatch = hour.match(/^\*\/(\d+)$/)
  if (min === '0' && everyNHoursMatch && dom === '*' && dow === '*') return `Every ${everyNHoursMatch[1]} hours`
  const isNumericMin = /^\d+$/.test(min)
  const isNumericHour = /^\d+$/.test(hour)
  if (isNumericMin && isNumericHour && dom === '*' && dow === '*') return `Daily at ${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))} UTC`
  const isNumericDow = /^\d$/.test(dow)
  if (isNumericMin && isNumericHour && dom === '*' && isNumericDow) {
    return `Weekly on ${DAY_NAMES[parseInt(dow, 10)] ?? `day ${dow}`} at ${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))} UTC`
  }
  const isNumericDom = /^\d+$/.test(dom)
  if (isNumericMin && isNumericHour && isNumericDom && dow === '*') return `Monthly on day ${dom} at ${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))} UTC`
  return 'Custom schedule'
}

// ── Cron next-run helper ──────────────────────────────────────────────────────

interface CronParseResult {
  description: string
  nextRuns: string[]
  error: string | null
}

function parseCronExpression(expr: string): CronParseResult {
  if (!expr || !expr.trim()) return { description: '', nextRuns: [], error: null }
  try {
    const job = new Cron(expr.trim(), { timezone: 'UTC' })
    const description = describeCron(expr.trim())
    const runs: string[] = []
    let cursor: Date | null = new Date()
    for (let i = 0; i < 3; i++) {
      cursor = job.nextRun(cursor)
      if (!cursor) break
      runs.push(
        cursor.toLocaleString() + ' (local) / ' + cursor.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      )
      cursor = new Date(cursor.getTime() + 1)
    }
    return { description, nextRuns: runs, error: null }
  } catch (err: unknown) {
    return {
      description: '',
      nextRuns: [],
      error: err instanceof Error ? err.message : 'Invalid cron expression',
    }
  }
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const linkStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--theme-text)',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
}

const mutedStyle: React.CSSProperties = {
  color: 'var(--theme-elevation-500)',
  fontSize: '12px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '13px',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-s)',
  background: 'var(--theme-elevation-0)',
  color: 'var(--theme-text)',
  boxSizing: 'border-box' as const,
  outline: 'none',
}

const pillStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '12px',
  background: 'var(--theme-elevation-50)',
  cursor: 'pointer',
  color: 'var(--theme-text)',
}

// ── ScheduleWidget ────────────────────────────────────────────────────────────

const ScheduleWidget: UIFieldClientComponent = () => {
  // Read sibling field values
  const schedule = useFormFields(([fields]) => fields.schedule?.value as string | undefined)
  const scheduleLimit = useFormFields(([fields]) => fields.scheduleLimit?.value as number | undefined)
  const scheduleCount = useFormFields(([fields]) => fields.scheduleCount?.value as number | undefined)
  const scheduledFor = useFormFields(([fields]) => fields.scheduledFor?.value as string | undefined)
  const status = useFormFields(([fields]) => fields.status?.value as string | undefined)

  // Write sibling fields
  const { setValue: setSchedule } = useField<string>({ path: 'schedule' })
  const { setValue: setScheduleLimit } = useField<number>({ path: 'scheduleLimit' })
  const { setValue: setScheduleCount } = useField<number>({ path: 'scheduleCount' })
  const { setValue: setStatus } = useField<string>({ path: 'status' })

  // Local drawer state
  const [draftCron, setDraftCron] = useState<string>('')
  const [draftLimit, setDraftLimit] = useState<number>(0)

  const drawerSlug = useDrawerSlug('schedule-editor')
  const { closeModal } = useModal()

  const parsed = schedule ? parseCronExpression(schedule) : null
  const drawerParsed = draftCron.trim() ? parseCronExpression(draftCron) : null

  const handleOpenDrawer = () => {
    setDraftCron(schedule ?? '')
    setDraftLimit(scheduleLimit ?? 0)
  }

  const handleApply = () => {
    setSchedule(draftCron.trim())
    setScheduleLimit(draftLimit)
    setScheduleCount(0)
    if (draftCron.trim()) {
      setStatus('scheduled')
    }
    closeModal(drawerSlug)
  }

  const handleClear = () => {
    setSchedule('')
    setScheduleLimit(0)
    setDraftCron('')
    setDraftLimit(0)
    if (status === 'scheduled') {
      setStatus('pending')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Sidebar compact card */}
      <div style={{
        background: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 'var(--style-radius-s)',
        padding: '10px 12px',
        marginBottom: 'var(--spacing-field)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: schedule ? '6px' : 0,
        }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--theme-elevation-500)',
          }}>
            Schedule
          </span>
          <DrawerToggler slug={drawerSlug} style={linkStyle} onClick={handleOpenDrawer}>
            {schedule ? 'Edit' : 'Configure'}
          </DrawerToggler>
        </div>

        {schedule && schedule.trim() ? (
          <>
            <div style={{ fontSize: '13px', color: 'var(--theme-text)', marginBottom: '2px' }}>
              {parsed?.error ? (
                <span style={{ color: 'var(--theme-error-500)' }}>Invalid expression</span>
              ) : (
                parsed?.description ?? describeCron(schedule)
              )}
            </div>
            <div style={mutedStyle}>
              {schedule}
              {(scheduleLimit ?? 0) > 0 && ` · ${scheduleCount ?? 0}/${scheduleLimit} runs`}
            </div>
            {status === 'scheduled' && scheduledFor && (
              <div style={{ ...mutedStyle, marginTop: '2px' }}>
                Next: {new Date(scheduledFor).toLocaleString()}
              </div>
            )}
          </>
        ) : (
          <span style={mutedStyle}>No recurring schedule</span>
        )}
      </div>

      {/* Drawer */}
      <Drawer slug={drawerSlug} title="Schedule Settings">
        <div style={{ padding: '20px' }}>

          {/* Section: Cron Expression */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)', marginBottom: '10px' }}>
              Cron Expression (UTC)
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setDraftCron(preset.value)}
                  style={{
                    ...pillStyle,
                    background: draftCron === preset.value ? 'var(--theme-elevation-200)' : 'var(--theme-elevation-50)',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={draftCron}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftCron(e.target.value)}
              placeholder="e.g. 0 6 * * *"
              style={inputStyle}
            />

            {draftCron.trim() && (
              <div style={{
                background: 'var(--theme-elevation-50)',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
                padding: '10px 12px',
                marginTop: '8px',
                fontSize: '13px',
              }}>
                {drawerParsed?.error ? (
                  <span style={{ color: 'var(--theme-error-500)' }}>{drawerParsed.error}</span>
                ) : (
                  <>
                    <div style={{ marginBottom: drawerParsed && drawerParsed.nextRuns.length > 0 ? '6px' : 0, color: 'var(--theme-text)' }}>
                      {drawerParsed?.description}
                    </div>
                    {drawerParsed && drawerParsed.nextRuns.length > 0 && (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', ...mutedStyle }}>
                        {drawerParsed.nextRuns.map((run, i) => (
                          <li key={i}>{run}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section: Run Limit */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)', marginBottom: '10px' }}>
              Run Limit
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--theme-elevation-500)', marginBottom: '4px' }}>
                  Max runs
                </label>
                <input
                  type="number"
                  min={0}
                  value={draftLimit}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftLimit(Number(e.target.value))}
                  style={inputStyle}
                />
                <div style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', marginTop: '4px' }}>
                  0 = unlimited
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--theme-elevation-500)', marginBottom: '4px' }}>
                  Completed runs
                </label>
                <div style={{
                  ...inputStyle,
                  background: 'var(--theme-elevation-100)',
                  color: 'var(--theme-elevation-500)',
                }}>
                  {scheduleCount ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleApply}
              disabled={Boolean(draftCron.trim() && drawerParsed?.error)}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
                background: 'var(--theme-elevation-100)',
                color: 'var(--theme-text)',
                cursor: draftCron.trim() && drawerParsed?.error ? 'not-allowed' : 'pointer',
                opacity: draftCron.trim() && drawerParsed?.error ? 0.5 : 1,
              }}
            >
              Apply
            </button>
            {schedule && (
              <button
                type="button"
                onClick={handleClear}
                style={{ ...linkStyle, color: 'var(--theme-error-500)' }}
              >
                Clear schedule
              </button>
            )}
          </div>

        </div>
      </Drawer>
    </>
  )
}

export default ScheduleWidget
