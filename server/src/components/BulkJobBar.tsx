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
    // Get selected IDs from the selection map
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

  if (!count || count === 0) return null

  const isActive = state === 'creating' || state === 'pending' || state === 'running'

  let buttonText: string
  switch (state) {
    case 'creating':
      buttonText = 'Creating job...'
      break
    case 'pending':
      buttonText = 'Waiting for worker...'
      break
    case 'running':
      buttonText = runningLabel
      break
    case 'completed':
      buttonText = 'Done!'
      break
    case 'failed':
      buttonText = error ?? 'Failed'
      break
    default:
      buttonText = `${label} ${count} ${count === 1 ? 'item' : 'items'}`
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 16px',
        marginBottom: '4px',
        borderRadius: 'var(--style-radius-s, 4px)',
        background: state === 'failed'
          ? 'var(--theme-error-50, #fef2f2)'
          : state === 'completed'
            ? 'var(--theme-success-50, #f0fdf4)'
            : 'var(--theme-elevation-100)',
        border: '1px solid var(--theme-elevation-200)',
        transition: 'all 0.2s ease',
      }}
    >
      {isActive && <Spinner />}
      {state === 'completed' && <Checkmark />}
      {state === 'failed' && <XMark />}

      <button
        type="button"
        disabled={isActive || state === 'completed'}
        onClick={handleClick}
        style={{
          all: 'unset',
          cursor: isActive || state === 'completed' ? 'default' : 'pointer',
          fontWeight: 500,
          fontSize: '13px',
          color: state === 'failed'
            ? 'var(--theme-error-500)'
            : state === 'completed'
              ? 'var(--theme-success-500)'
              : 'var(--theme-text)',
          opacity: isActive ? 0.7 : 1,
          textDecoration: state === 'idle' ? 'underline' : 'none',
          textUnderlineOffset: '2px',
        }}
      >
        {buttonText}
      </button>
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

function Checkmark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 7.5L5.5 10L11 4" stroke="var(--theme-success-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function XMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M4 4l6 6M10 4l-6 6" stroke="var(--theme-error-500)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
