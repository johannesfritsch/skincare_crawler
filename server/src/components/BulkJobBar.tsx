'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSelection } from '@payloadcms/ui'
import { getJobStatus } from '@/actions/job-actions'

type JobState = 'idle' | 'creating' | 'pending' | 'running' | 'completed' | 'failed'

type JobResult = { success: boolean; jobId?: number; error?: string }
type JobCollection = Parameters<typeof getJobStatus>[0]

const POLL_INTERVAL = 2000

interface BulkJobBarProps {
  /** Button label (e.g. "Crawl", "Aggregate") */
  label: string
  /** Label while running (e.g. "Crawling...", "Aggregating...") */
  runningLabel: string
  /** Server action that creates the job from selected IDs */
  createJob: (ids: number[]) => Promise<JobResult>
  /** Which job collection to poll status from */
  jobCollection: JobCollection
}

export function BulkJobBar({ label, runningLabel, createJob, jobCollection }: BulkJobBarProps) {
  const { count, selected } = useSelection()
  const [state, setState] = useState<JobState>('idle')
  const [jobId, setJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Reset when selection changes
  useEffect(() => {
    if (state === 'completed' || state === 'failed') {
      setState('idle')
      setJobId(null)
      setError(null)
    }
  }, [count]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!jobId || (state !== 'pending' && state !== 'running')) return

    const poll = async () => {
      try {
        const result = await getJobStatus(jobCollection, jobId)
        if (result.status === 'completed') {
          setState('completed')
          stopPolling()
        } else if (result.status === 'failed') {
          setState('failed')
          setError(`Failed (${result.errors ?? 0} errors)`)
          stopPolling()
        } else if (result.status === 'in_progress') {
          setState('running')
        }
      } catch {
        // Silently ignore transient polling errors
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL)
    return stopPolling
  }, [jobId, state, stopPolling, jobCollection])

  const handleClick = async () => {
    const ids: number[] = []
    if (selected) {
      const map = selected instanceof Map ? selected : new Map(Object.entries(selected))
      map.forEach((isSelected, id) => {
        if (isSelected) ids.push(Number(id))
      })
    }

    if (ids.length === 0) return

    setState('creating')
    setError(null)
    setJobId(null)

    try {
      const result = await createJob(ids)
      if (result.success && result.jobId) {
        setJobId(result.jobId)
        setState('pending')
      } else {
        setState('failed')
        setError(result.error || 'Failed to create job')
      }
    } catch (err) {
      setState('failed')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const isActive = state === 'creating' || state === 'pending' || state === 'running'
  const hasSelection = count && count > 0
  const disabled = !hasSelection || isActive || state === 'completed'

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
      text = hasSelection ? `${label} ${count} selected` : `${label} (select items)`
  }

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
        opacity: disabled && state === 'idle' ? 0.5 : 1,
        color: state === 'failed'
          ? 'var(--theme-error-500)'
          : state === 'completed'
            ? 'var(--theme-success-500)'
            : undefined,
      }}
    >
      {isActive && <Spinner />}
      {text}
    </button>
  )
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
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
