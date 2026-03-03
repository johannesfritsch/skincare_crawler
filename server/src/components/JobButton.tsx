'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@payloadcms/ui'
import { getJobStatus, getJobEvents } from '@/actions/job-actions'
import { getJobState, setJobState } from '@/components/BulkJobBar'

type JobState = 'idle' | 'creating' | 'pending' | 'running' | 'completed' | 'failed'

const POLL_INTERVAL = 2000

type JobResult = { success: boolean; jobId?: number; error?: string }
type JobCollection = Parameters<typeof getJobStatus>[0]

interface JobButtonProps {
  /** Label shown in idle state (e.g. "Crawl", "Aggregate") */
  label: string
  /** Label shown while the job is running (e.g. "Crawling...", "Aggregating...") */
  runningLabel: string
  /** Server action that creates the job, returns { success, jobId, error } */
  createJob: () => Promise<JobResult>
  /** Server action that polls job status, returns { status, errors } */
  getStatus: (jobId: number) => Promise<{ status: string; errors?: number }>
  /**
   * Job collection slug — used to publish state into the shared pub/sub store
   * so a co-located JobStatusBar renders the event log below the tabs.
   */
  jobCollection: JobCollection
  /** Called when the job completes successfully (e.g. router.refresh) */
  onCompleted?: () => void
}

export function JobButton({ label, runningLabel, createJob, getStatus, jobCollection, onCompleted }: JobButtonProps) {
  const [state, setState] = useState<JobState>('idle')
  const [jobId, setJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastEventDateRef = useRef<string | undefined>(undefined)

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
        const [result, newEvents] = await Promise.all([
          getStatus(jobId),
          getJobEvents(jobCollection, jobId, lastEventDateRef.current),
        ])

        if (newEvents.length > 0) {
          lastEventDateRef.current = newEvents[newEvents.length - 1].createdAt
          const prev = getJobState(jobCollection)
          setJobState(jobCollection, { events: [...prev.events, ...newEvents] })
        }

        if (result.status === 'completed') {
          setState('completed')
          setJobState(jobCollection, { state: 'completed' })
          stopPolling()
          onCompleted?.()
        } else if (result.status === 'failed') {
          const errMsg = `Failed (${result.errors ?? 0} errors)`
          setState('failed')
          setError(errMsg)
          setJobState(jobCollection, { state: 'failed', error: errMsg })
          stopPolling()
        } else if (result.status === 'in_progress') {
          setState('running')
          setJobState(jobCollection, { state: 'running' })
        }
      } catch {
        // Silently ignore transient polling errors
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL)
    return stopPolling
  }, [jobId, state, stopPolling, getStatus, jobCollection, onCompleted])

  const handleClick = async () => {
    setState('creating')
    setError(null)
    setJobId(null)
    setJobState(jobCollection, { state: 'creating', error: null, events: [] })
    lastEventDateRef.current = undefined

    try {
      const result = await createJob()
      if (result.success && result.jobId) {
        setJobId(result.jobId)
        setState('pending')
        setJobState(jobCollection, { state: 'pending' })
      } else {
        const errMsg = result.error || 'Failed to create job'
        setState('failed')
        setError(errMsg)
        setJobState(jobCollection, { state: 'failed', error: errMsg })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setState('failed')
      setError(errMsg)
      setJobState(jobCollection, { state: 'failed', error: errMsg })
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
