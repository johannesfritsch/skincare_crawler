'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button, SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { crawlSourceProduct, getCrawlStatus } from '@/actions/crawl-source-product'

type CrawlState = 'idle' | 'creating' | 'pending' | 'crawling' | 'completed' | 'failed'

const POLL_INTERVAL = 2000 // ms

export default function SourceProductSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const [crawlState, setCrawlState] = useState<CrawlState>('idle')
  const [crawlId, setCrawlId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Poll for crawl status
  useEffect(() => {
    if (!crawlId || (crawlState !== 'pending' && crawlState !== 'crawling')) {
      return
    }

    const poll = async () => {
      try {
        const result = await getCrawlStatus(crawlId)
        if (result.status === 'completed') {
          setCrawlState('completed')
          stopPolling()
        } else if (result.status === 'failed') {
          setCrawlState('failed')
          setError(`Crawl failed (${result.errors} errors)`)
          stopPolling()
        } else if (result.status === 'in_progress') {
          setCrawlState('crawling')
        }
      } catch {
        // Silently ignore transient fetch errors during polling
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL)

    return stopPolling
  }, [crawlId, crawlState, stopPolling])

  const handleCrawl = async () => {
    if (!id) return
    setCrawlState('creating')
    setError(null)
    setCrawlId(null)

    try {
      const result = await crawlSourceProduct(Number(id))
      if (result.success && result.crawlId) {
        setCrawlId(result.crawlId)
        setCrawlState('pending')
      } else {
        setCrawlState('failed')
        setError(result.error || 'Failed to create crawl')
      }
    } catch (err) {
      setCrawlState('failed')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const isActive = crawlState === 'creating' || crawlState === 'pending' || crawlState === 'crawling'

  const buttonStyle = crawlState === 'failed' ? 'error' as const : 'secondary' as const

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <Button
          buttonStyle={buttonStyle}
          size="medium"
          type="button"
          disabled={isActive}
          onClick={handleCrawl}
          tooltip={error ?? undefined}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {isActive && <Spinner />}
            <CrawlButtonLabel state={crawlState} />
          </span>
        </Button>
      )}
    </div>
  )
}

function CrawlButtonLabel({ state }: { state: CrawlState }) {
  switch (state) {
    case 'creating':
      return <>Creating...</>
    case 'pending':
      return <>Waiting for worker...</>
    case 'crawling':
      return <>Crawling...</>
    case 'completed':
      return <>Done</>
    case 'failed':
      return <>Retry Crawl</>
    default:
      return <>Crawl</>
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
