'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@payloadcms/ui'

type JobState = 'idle' | 'creating' | 'pending' | 'running' | 'completed' | 'failed'

const POLL_INTERVAL = 2000

type JobResult = { success: boolean; jobId?: number; error?: string }

interface JobButtonProps {
  /** Label shown in idle state (e.g. "Crawl", "Aggregate") */
  label: string
  /** Label shown while the job is running (e.g. "Crawling...", "Aggregating...") */
  runningLabel: string
  /** Server action that creates the job, returns { success, jobId, error } */
  createJob: () => Promise<JobResult>
  /** Server action that polls job status, returns { status, errors } */
  getStatus: (jobId: number) => Promise<{ status: string; errors?: number }>
  /** Called when the job completes successfully (e.g. router.refresh) */
  onCompleted?: () => void
}

export function JobButton({ label, runningLabel, createJob, getStatus, onCompleted }: JobButtonProps) {
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

  useEffect(() => {
    if (!jobId || (state !== 'pending' && state !== 'running')) return

    const poll = async () => {
      try {
        const result = await getStatus(jobId)
        if (result.status === 'completed') {
          setState('completed')
          stopPolling()
          onCompleted?.()
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
  }, [jobId, state, stopPolling, getStatus, onCompleted])

  const handleClick = async () => {
    setState('creating')
    setError(null)
    setJobId(null)

    try {
      const result = await createJob()
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
  const buttonStyle = state === 'failed' ? ('error' as const) : ('secondary' as const)

  let buttonLabel: string
  switch (state) {
    case 'creating':
      buttonLabel = 'Creating...'
      break
    case 'pending':
      buttonLabel = 'Waiting for worker...'
      break
    case 'running':
      buttonLabel = runningLabel
      break
    case 'completed':
      buttonLabel = 'Done'
      break
    case 'failed':
      buttonLabel = `Retry ${label}`
      break
    default:
      buttonLabel = label
  }

  return (
    <Button
      buttonStyle={buttonStyle}
      size="medium"
      type="button"
      disabled={isActive}
      onClick={handleClick}
      tooltip={error ?? undefined}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        {isActive && <Spinner />}
        {buttonLabel}
      </span>
    </Button>
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
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
