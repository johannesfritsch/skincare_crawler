'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button, useSelection } from '@payloadcms/ui'
import { getJobStatus, getJobEvents } from '@/actions/job-actions'
import type { JobEvent } from '@/actions/job-actions'
import { EventRow, Spinner, CheckIcon, ErrorIcon } from './event-display-utils'

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

export function getJobState(key: string): SharedJobState {
  return jobStates.get(key) ?? { state: 'idle', error: null, events: [] }
}

export function setJobState(key: string, update: Partial<SharedJobState>) {
  const prev = getJobState(key)
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
  return getJobState(key)
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
          const prev = getJobState(jobCollection)
          lastEventDateRef.current = newEvents[newEvents.length - 1].createdAt
          setJobState(jobCollection, { events: [...prev.events, ...newEvents] })
        }

        if (statusResult.status === 'completed') {
          setJobState(jobCollection, { state: 'completed' })
          stopPolling()
        } else if (statusResult.status === 'failed') {
          setJobState(jobCollection, {
            state: 'failed',
            error: `Failed (${statusResult.errors ?? 0} errors)`,
          })
          stopPolling()
        } else if (statusResult.status === 'in_progress') {
          setJobState(jobCollection, { state: 'running' })
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

    setJobState(jobCollection, { state: 'creating', error: null, events: [] })
    jobIdRef.current = null

    try {
      const result = await createJob(ids)
      if (result.success && result.jobId) {
        jobIdRef.current = result.jobId
        setJobState(jobCollection, { state: 'pending' })
        startPolling()
      } else {
        setJobState(jobCollection, { state: 'failed', error: result.error || 'Failed to create job' })
      }
    } catch (err) {
      setJobState(jobCollection, {
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

// ---- JobStatusBar: shared display component for both list and detail views ----

interface JobStatusBarProps {
  runningLabel: string
  jobCollection: JobCollection
  /** Additional action called on dismiss, before the default router.refresh() */
  onDismiss?: () => void
}

export function JobStatusBar({ runningLabel, jobCollection, onDismiss }: JobStatusBarProps) {
  const { state, error, events } = useJobState(jobCollection)
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
    setJobState(jobCollection, { state: 'idle', error: null, events: [] })
    onDismiss?.()
    router.refresh()
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
            {isDone ? 'Reload' : 'Dismiss'}
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

// ---- Status bar: rendered via beforeListTable (list view) ----

interface BulkJobStatusBarProps {
  runningLabel: string
  jobCollection: JobCollection
}

export function BulkJobStatusBar({ runningLabel, jobCollection }: BulkJobStatusBarProps) {
  const { selectAll, toggleAll } = useSelection()

  const handleDismiss = useCallback(() => {
    if (selectAll !== 'none') toggleAll()
  }, [selectAll, toggleAll])

  return (
    <JobStatusBar
      runningLabel={runningLabel}
      jobCollection={jobCollection}
      onDismiss={handleDismiss}  // clears selection; JobStatusBar also calls router.refresh()
    />
  )
}

