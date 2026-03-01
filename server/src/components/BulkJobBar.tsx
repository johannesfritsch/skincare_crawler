'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSelection } from '@payloadcms/ui'
import { getJobStatus } from '@/actions/job-actions'

// ---- Shared types ----

type JobState = 'idle' | 'creating' | 'pending' | 'running' | 'completed' | 'failed'
type JobResult = { success: boolean; jobId?: number; error?: string }
type JobCollection = Parameters<typeof getJobStatus>[0]

const POLL_INTERVAL = 2000

// ---- Module-level state shared between menu item and status bar ----
// Both components are rendered in different parts of the tree (listMenuItems vs beforeListTable)
// so React context won't work. Instead, we use a simple pub/sub per collection slug.

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()
const jobStates = new Map<string, { state: JobState; error: string | null }>()

function getState(key: string) {
  return jobStates.get(key) ?? { state: 'idle' as JobState, error: null }
}

function setJobState(key: string, state: JobState, error: string | null = null) {
  jobStates.set(key, { state, error })
  listeners.get(key)?.forEach((l) => l())
}

function subscribe(key: string, listener: Listener) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key)!.add(listener)
  return () => { listeners.get(key)?.delete(listener) }
}

function useJobState(key: string) {
  const [, forceUpdate] = useState(0)
  useEffect(() => subscribe(key, () => forceUpdate((n) => n + 1)), [key])
  return getState(key)
}

// ---- Menu item: rendered inside listMenuItems (three-dot popup) ----

interface BulkJobMenuItemProps {
  /** Button label (e.g. "Crawl", "Aggregate") */
  label: string
  /** Server action that creates the job from selected IDs */
  createJob: (ids: number[]) => Promise<JobResult>
  /** Which job collection to poll status from */
  jobCollection: JobCollection
}

export function BulkJobMenuItem({ label, createJob, jobCollection }: BulkJobMenuItemProps) {
  const { count, selected } = useSelection()
  const { state } = useJobState(jobCollection)
  const jobIdRef = useRef<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Clean up polling on unmount
  useEffect(() => stopPolling, [stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    const poll = async () => {
      const id = jobIdRef.current
      if (!id) return
      try {
        const result = await getJobStatus(jobCollection, id)
        if (result.status === 'completed') {
          setJobState(jobCollection, 'completed')
          stopPolling()
        } else if (result.status === 'failed') {
          setJobState(jobCollection, 'failed', `Failed (${result.errors ?? 0} errors)`)
          stopPolling()
        } else if (result.status === 'in_progress') {
          setJobState(jobCollection, 'running')
        }
      } catch {
        // ignore
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

    setJobState(jobCollection, 'creating')
    jobIdRef.current = null

    try {
      const result = await createJob(ids)
      if (result.success && result.jobId) {
        jobIdRef.current = result.jobId
        setJobState(jobCollection, 'pending')
        startPolling()
      } else {
        setJobState(jobCollection, 'failed', result.error || 'Failed to create job')
      }
    } catch (err) {
      setJobState(jobCollection, 'failed', err instanceof Error ? err.message : 'Unknown error')
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

// ---- Status bar: rendered via beforeListTable (only visible when job is active/done) ----

interface BulkJobStatusBarProps {
  /** Label while running (e.g. "Crawling...", "Aggregating...") */
  runningLabel: string
  /** Which job collection to observe */
  jobCollection: JobCollection
}

export function BulkJobStatusBar({ runningLabel, jobCollection }: BulkJobStatusBarProps) {
  const { state, error } = useJobState(jobCollection)

  if (state === 'idle') return null

  const isActive = state === 'creating' || state === 'pending' || state === 'running'

  let text: string
  switch (state) {
    case 'creating':
      text = 'Creating job...'
      break
    case 'pending':
      text = 'Waiting for worker...'
      break
    case 'running':
      text = runningLabel
      break
    case 'completed':
      text = 'Done!'
      break
    case 'failed':
      text = error ?? 'Failed'
      break
    default:
      text = ''
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        marginBottom: '4px',
        borderRadius: 'var(--style-radius-s, 4px)',
        fontSize: '13px',
        fontWeight: 500,
        background: state === 'failed'
          ? 'var(--theme-error-50, #fef2f2)'
          : state === 'completed'
            ? 'var(--theme-success-50, #f0fdf4)'
            : 'var(--theme-elevation-100)',
        color: state === 'failed'
          ? 'var(--theme-error-500)'
          : state === 'completed'
            ? 'var(--theme-success-500)'
            : 'var(--theme-text)',
        border: '1px solid var(--theme-elevation-200)',
      }}
    >
      {isActive && <Spinner />}
      {text}
    </div>
  )
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
