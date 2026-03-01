'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button, useSelection } from '@payloadcms/ui'
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
  const buttonStyle = state === 'failed' ? ('error' as const) : ('secondary' as const)

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
    <div style={{ marginBottom: '4px' }}>
      <Button
        buttonStyle={buttonStyle}
        size="small"
        type="button"
        disabled={isActive || state === 'completed'}
        onClick={handleClick}
        tooltip={error ?? undefined}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          {isActive && <Spinner />}
          {buttonText}
        </span>
      </Button>
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


