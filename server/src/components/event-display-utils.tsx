'use client'

import React from 'react'
import type { JobEvent } from '@/actions/job-actions'

// ---- Data filtering & formatting ----

export const HIDDEN_KEYS = new Set(['url', 'source', 'sourceUrl'])

export const KEY_LABELS: Record<string, string> = {
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

export const SUMMARY_MESSAGES = new Set([
  'Job started',
  'Batch done',
  'Batch persisted',
  'Search results persisted',
  'Completed',
  'Job error, will retry',
  'Job failed',
  'Job failed: max retries exceeded',
])

export function formatValue(key: string, raw: string | number | boolean): string {
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

export function filterDisplayData(
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

export function cleanMessage(msg: string): string {
  return msg.replace(/^\[[^\]]+\]\s*/, '')
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function isSummaryEvent(msg: string): boolean {
  return SUMMARY_MESSAGES.has(msg.replace(/^\[[^\]]+\]\s*/, ''))
}

// ---- SVG icons ----

export function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8l2.5 2.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  )
}

// ---- Data pill ----

export function DataPill({
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

// ---- Event row ----

export function EventRow({ event }: { event: JobEvent }) {
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
