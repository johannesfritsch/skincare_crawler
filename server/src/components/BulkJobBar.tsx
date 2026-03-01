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
        // Poll status and events in parallel
        const [statusResult, newEvents] = await Promise.all([
          getJobStatus(jobCollection, id),
          getJobEvents(jobCollection, id, lastEventDateRef.current),
        ])

        // Append new events
        if (newEvents.length > 0) {
          const prev = getState(jobCollection)
          lastEventDateRef.current = newEvents[newEvents.length - 1].createdAt
          setState(jobCollection, {
            events: [...prev.events, ...newEvents],
          })
        }

        // Update status
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

  let statusText: string
  switch (state) {
    case 'creating':
      statusText = 'Creating job...'
      break
    case 'pending':
      statusText = 'Waiting for worker...'
      break
    case 'running':
      statusText = runningLabel
      break
    case 'completed':
      statusText = 'Done!'
      break
    case 'failed':
      statusText = error ?? 'Failed'
      break
    default:
      statusText = ''
  }

  return (
    <div
      style={{
        fontSize: '13px',
        padding: 'calc(var(--base) * 0.6) calc(var(--base) * 0.8)',
        background: 'var(--theme-elevation-50)',
        borderBottom: '1px solid var(--theme-elevation-100)',
      }}
    >
      {/* Status line */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontWeight: 500,
          color: state === 'failed'
            ? 'var(--theme-error-500)'
            : state === 'completed'
              ? 'var(--theme-success-500)'
              : 'var(--theme-elevation-400)',
        }}
      >
        {isActive && <Spinner />}
        <span>{statusText}</span>
        {state === 'completed' && (
          <Button
            buttonStyle="secondary"
            size="small"
            type="button"
            onClick={() => {
              if (selectAll !== 'none') toggleAll()
              setState(jobCollection, { state: 'idle', error: null, events: [] })
              router.refresh()
            }}
          >
            Reload
          </Button>
        )}
      </div>

      {/* Event log */}
      {events.length > 0 && (
        <div
          ref={logRef}
          style={{
            maxHeight: '160px',
            overflowY: 'auto',
            marginTop: 'calc(var(--base) * 0.4)',
          }}
        >
          {events.map((event, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '8px',
                padding: '1px 0',
                lineHeight: '1.4',
                color: event.type === 'error'
                  ? 'var(--theme-error-500)'
                  : event.type === 'warning'
                    ? 'var(--theme-warning-500, #d97706)'
                    : 'var(--theme-elevation-400)',
              }}
            >
              <span style={{ flexShrink: 0, opacity: 0.5 }}>
                {formatTime(event.createdAt)}
              </span>
              <span>{cleanMessage(event.message)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Helpers ----

/** Strip "[tag] " prefixes from worker log messages */
function cleanMessage(msg: string): string {
  return msg.replace(/^\[[^\]]+\]\s*/, '')
}

/** Format ISO date to HH:MM:SS */
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
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
