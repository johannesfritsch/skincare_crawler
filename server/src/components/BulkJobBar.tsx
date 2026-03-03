'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button, useSelection } from '@payloadcms/ui'
import { getJobStatus, getJobEvents } from '@/actions/job-actions'
import type { JobEvent } from '@/actions/job-actions'

// ---- Shared types ----

type JobState = 'idle' | 'creating' | 'pending' | 'running' | 'completed' | 'failed'
type JobResult = { success: boolean; jobId?: number; error?: string }
type JobCollection = Parameters<typeof getJobStatus>[0]

const POLL_INTERVAL = 1000

// ---- Module-level pub/sub for cross-slot state sharing ----

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

interface SharedJobState {
  state: JobState
  error: string | null
  events: JobEvent[]
}

const jobStates = new Map<string, SharedJobState>()

function getState(key: string): SharedJobState {
  return jobStates.get(key) ?? { state: 'idle', error: null, events: [] }
}

function setState(key: string, update: Partial<SharedJobState>) {
  const prev = getState(key)
  jobStates.set(key, { ...prev, ...update })
  listeners.get(key)?.forEach((l) => l())
}

function subscribe(key: string, listener: Listener) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key)!.add(listener)
  return () => { listeners.get(key)?.delete(listener) }
}

function useJobState(key: string): SharedJobState {
  const [, forceUpdate] = useState(0)
  useEffect(() => subscribe(key, () => forceUpdate((n) => n + 1)), [key])
  return getState(key)
}

// ---- Menu item: rendered inside listMenuItems (three-dot popup) ----

interface BulkJobMenuItemProps {
  label: string
  createJob: (ids: number[]) => Promise<JobResult>
  jobCollection: JobCollection
}

export function BulkJobMenuItem({ label, createJob, jobCollection }: BulkJobMenuItemProps) {
  const { count, selected } = useSelection()
  const { state } = useJobState(jobCollection)
  const jobIdRef = useRef<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastEventDateRef = useRef<string | undefined>(undefined)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    lastEventDateRef.current = undefined

    const poll = async () => {
      const id = jobIdRef.current
      if (!id) return

      try {
        const [statusResult, newEvents] = await Promise.all([
          getJobStatus(jobCollection, id),
          getJobEvents(jobCollection, id, lastEventDateRef.current),
        ])

        if (newEvents.length > 0) {
          const prev = getState(jobCollection)
          lastEventDateRef.current = newEvents[newEvents.length - 1].createdAt
          setState(jobCollection, { events: [...prev.events, ...newEvents] })
        }

        if (statusResult.status === 'completed') {
          setState(jobCollection, { state: 'completed' })
          stopPolling()
        } else if (statusResult.status === 'failed') {
          setState(jobCollection, {
            state: 'failed',
            error: `Failed (${statusResult.errors ?? 0} errors)`,
          })
          stopPolling()
        } else if (statusResult.status === 'in_progress') {
          setState(jobCollection, { state: 'running' })
        }
      } catch {
        // ignore transient errors
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL)
  }, [jobCollection, stopPolling])

  const handleClick = async () => {
    const ids: number[] = []
    if (selected) {
      const map = selected instanceof Map ? selected : new Map(Object.entries(selected))
      map.forEach((isSelected, id) => {
        if (isSelected) ids.push(Number(id))
      })
    }
    if (ids.length === 0) return

    setState(jobCollection, { state: 'creating', error: null, events: [] })
    jobIdRef.current = null

    try {
      const result = await createJob(ids)
      if (result.success && result.jobId) {
        jobIdRef.current = result.jobId
        setState(jobCollection, { state: 'pending' })
        startPolling()
      } else {
        setState(jobCollection, { state: 'failed', error: result.error || 'Failed to create job' })
      }
    } catch (err) {
      setState(jobCollection, {
        state: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const hasSelection = count && count > 0
  const isActive = state === 'creating' || state === 'pending' || state === 'running'
  const disabled = !hasSelection || isActive

  const text = hasSelection ? `${label} ${count} selected` : `${label} (select items)`

  return (
    <button
      type="button"
      disabled={!!disabled}
      onClick={handleClick}
      className="popup-button-list__button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {text}
    </button>
  )
}

// ---- Status bar: rendered via beforeListTable ----

interface BulkJobStatusBarProps {
  runningLabel: string
  jobCollection: JobCollection
}

export function BulkJobStatusBar({ runningLabel, jobCollection }: BulkJobStatusBarProps) {
  const { state, error, events } = useJobState(jobCollection)
  const { selectAll, toggleAll } = useSelection()
  const logRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events.length])

  if (state === 'idle') return null

  const isActive = state === 'creating' || state === 'pending' || state === 'running'
  const isDone = state === 'completed'
  const isFailed = state === 'failed'

  const handleDismiss = () => {
    if (selectAll !== 'none') toggleAll()
    setState(jobCollection, { state: 'idle', error: null, events: [] })
    if (isDone) router.refresh()
  }

  // Completed and failed: log above + footer bar with action
  if (isDone || isFailed) {
    return (
      <div
        style={{
          fontSize: '13px',
          background: 'var(--theme-elevation-50)',
          borderBottom: '1px solid var(--theme-elevation-150)',
        }}
      >
        {/* Event log — same as running state */}
        {events.length > 0 && (
          <div
            ref={logRef}
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              padding: 'calc(var(--base) * 0.4) calc(var(--base) * 0.8)',
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
              fontSize: '12px',
              lineHeight: '1.5',
              borderBottom: `1px solid ${isDone ? 'var(--theme-success-200)' : 'var(--theme-error-200)'}`,
            }}
          >
            {events.map((event, i) => (
              <EventRow key={i} event={event} />
            ))}
          </div>
        )}

        {/* Footer bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: 'calc(var(--base) * 0.5) calc(var(--base) * 0.8)',
            background: isDone ? 'var(--theme-success-50)' : 'var(--theme-error-50)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: isDone ? 'var(--theme-success-600)' : 'var(--theme-error-600)',
              fontWeight: 500,
            }}
          >
            {isDone ? <CheckIcon /> : <ErrorIcon />}
            <span>{isDone ? 'Completed successfully' : (error ?? 'Job failed')}</span>
          </div>
          <Button
            buttonStyle={isDone ? 'primary' : 'secondary'}
            size="small"
            type="button"
            onClick={handleDismiss}
          >
            {isDone ? 'Reload list' : 'Dismiss'}
          </Button>
        </div>
      </div>
    )
  }

  // Running state: status line + event log
  let statusText: string
  switch (state) {
    case 'creating':  statusText = 'Creating job...'; break
    case 'pending':   statusText = 'Waiting for worker...'; break
    case 'running':   statusText = runningLabel; break
    default:          statusText = ''
  }

  return (
    <div
      style={{
        fontSize: '13px',
        background: 'var(--theme-elevation-50)',
        borderBottom: '1px solid var(--theme-elevation-150)',
      }}
    >
      {/* Status line */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: 'calc(var(--base) * 0.5) calc(var(--base) * 0.8)',
          color: 'var(--theme-elevation-800)',
          fontWeight: 500,
          borderBottom: events.length > 0 ? '1px solid var(--theme-elevation-100)' : undefined,
        }}
      >
        <Spinner />
        <span>{statusText}</span>
      </div>

      {/* Event log */}
      {events.length > 0 && (
        <div
          ref={logRef}
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            padding: 'calc(var(--base) * 0.4) calc(var(--base) * 0.8)',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
            fontSize: '12px',
            lineHeight: '1.5',
          }}
        >
          {events.map((event, i) => (
            <EventRow key={i} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Event row ----

const SUMMARY_MESSAGES = new Set([
  'Job started',
  'Batch done',
  'Batch persisted',
  'Search results persisted',
  'Completed',
  'Job error, will retry',
  'Job failed',
  'Job failed: max retries exceeded',
])

function isSummaryEvent(msg: string): boolean {
  return SUMMARY_MESSAGES.has(msg.replace(/^\[[^\]]+\]\s*/, ''))
}

function EventRow({ event }: { event: JobEvent }) {
  const message = cleanMessage(event.message)
  const isSummary = isSummaryEvent(event.message)
  const displayData = event.data ? filterDisplayData(event.data) : null

  const isError = event.type === 'error'
  const isWarning = event.type === 'warning'
  const isSuccess = event.type === 'success'
  const isStart = event.type === 'start'

  // Message color: errors/warnings/success get semantic color, others use full-contrast text
  const msgColor = isError
    ? 'var(--theme-error-500)'
    : isWarning
      ? 'var(--theme-warning-600)'
      : isSuccess
        ? 'var(--theme-success-600)'
        : isStart
          ? 'var(--theme-elevation-800)'
          : 'var(--theme-elevation-800)'

  return (
    <div
      style={{
        paddingTop: isSummary ? '6px' : '1px',
        paddingBottom: '1px',
        borderTop: isSummary ? '1px solid var(--theme-elevation-150)' : undefined,
        marginTop: isSummary ? '4px' : undefined,
      }}
    >
      {/* Message line */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
        <span
          style={{
            flexShrink: 0,
            fontSize: '11px',
            color: 'var(--theme-elevation-500)',
            minWidth: '62px',
          }}
        >
          {formatTime(event.createdAt)}
        </span>
        <span
          style={{
            color: msgColor,
            fontWeight: isSummary ? 600 : 400,
          }}
        >
          {message}
        </span>
      </div>

      {/* Data pills */}
      {displayData && displayData.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '3px',
            marginLeft: '70px',
            marginTop: '3px',
            marginBottom: '3px',
          }}
        >
          {displayData.map(([key, value]) => (
            <DataPill key={key} label={key} value={value} isError={isError} isWarning={isWarning} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Data pill ----

function DataPill({
  label,
  value,
  isError,
  isWarning,
}: {
  label: string
  value: string
  isError: boolean
  isWarning: boolean
}) {
  const bg = isError
    ? 'var(--theme-error-100)'
    : isWarning
      ? 'var(--theme-warning-100)'
      : 'var(--theme-elevation-150)'

  const textColor = isError
    ? 'var(--theme-error-600)'
    : isWarning
      ? 'var(--theme-warning-600)'
      : 'var(--theme-elevation-800)'

  const labelColor = isError
    ? 'var(--theme-error-400)'
    : isWarning
      ? 'var(--theme-warning-600)'
      : 'var(--theme-elevation-500)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0',
        fontSize: '11px',
        lineHeight: '1',
        background: bg,
        borderRadius: '3px',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          padding: '2px 4px',
          color: labelColor,
        }}
      >
        {label}
      </span>
      <span
        style={{
          padding: '2px 5px 2px 4px',
          color: textColor,
          fontWeight: 600,
          background: isError
            ? 'var(--theme-error-150)'
            : isWarning
              ? 'var(--theme-warning-150)'
              : 'var(--theme-elevation-200)',
        }}
      >
        {value}
      </span>
    </span>
  )
}

// ---- Data filtering & formatting ----

const HIDDEN_KEYS = new Set(['url', 'source', 'sourceUrl'])

function formatValue(key: string, raw: string | number | boolean): string {
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no'

  if (key === 'durationMs' || key === 'batchDurationMs') {
    const ms = Number(raw)
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const mins = Math.floor(ms / 60000)
    const secs = Math.round((ms % 60000) / 1000)
    return `${mins}m${secs}s`
  }

  if (key === 'errorRate') return `${raw}%`

  if (key === 'previousCents' || key === 'currentCents') {
    return `€${(Number(raw) / 100).toFixed(2)}`
  }

  return String(raw)
}

const KEY_LABELS: Record<string, string> = {
  crawled: 'crawled',
  errors: 'errors',
  remaining: 'remaining',
  batchSize: 'batch',
  batchSuccesses: 'ok',
  batchErrors: 'failed',
  errorRate: 'err%',
  batchDurationMs: 'took',
  durationMs: 'took',
  newVariants: '+variants',
  existingVariants: '=variants',
  withIngredients: 'w/ingredients',
  priceChanges: 'price Δ',
  discovered: 'discovered',
  created: 'created',
  existing: 'existing',
  batchPersisted: 'persisted',
  pagesUsed: 'pages',
  persisted: 'persisted',
  sources: 'sources',
  query: 'query',
  maxResults: 'max',
  items: 'items',
  crawlVariants: 'variants',
  urlCount: 'urls',
  currentUrlIndex: 'at url',
  maxPages: 'maxPages',
  variants: 'variants',
  images: 'images',
  hasIngredients: 'ingredients',
  name: 'name',
  change: 'change',
  previousCents: 'was',
  currentCents: 'now',
  chars: 'chars',
  retryCount: 'retry',
  maxRetries: 'maxRetries',
  reason: 'reason',
  totalVariants: 'total',
}

function filterDisplayData(
  data: Record<string, string | number | boolean>,
): [string, string][] {
  const entries: [string, string][] = []

  for (const [key, value] of Object.entries(data)) {
    if (HIDDEN_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    // Skip zero-value counters that add noise (but keep errors=0 and remaining=0 — meaningful)
    if (typeof value === 'number' && value === 0 && key !== 'errors' && key !== 'remaining') continue

    const label = KEY_LABELS[key] ?? key
    const formatted = formatValue(key, value)
    entries.push([label, formatted])
  }

  return entries
}

// ---- Helpers ----

function cleanMessage(msg: string): string {
  return msg.replace(/^\[[^\]]+\]\s*/, '')
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8l2.5 2.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  )
}
