'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DefaultCellComponentProps } from 'payload'

export default function CrawlItemStatusCell({ rowData }: DefaultCellComponentProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = rowData?.status as string
  const itemId = rowData?.id as number
  const crawlId = (typeof rowData?.crawl === 'object' ? rowData?.crawl?.id : rowData?.crawl) as number

  const handleCrawl = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!crawlId || !itemId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/crawl/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crawlId, itemId }),
      })

      const data = await response.json()

      if (data.success && data.results?.[0]?.productId) {
        router.push(`/admin/collections/dm-products/${data.results[0].productId}`)
      } else if (data.success) {
        router.refresh()
      } else {
        setError(data.error || 'Failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'crawled') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--theme-success-500)' }}>Crawled</span>
        <button
          onClick={handleCrawl}
          disabled={loading}
          style={{
            padding: '2px 6px',
            fontSize: '12px',
            background: 'var(--theme-elevation-150)',
            border: '1px solid var(--theme-elevation-250)',
            borderRadius: 'var(--style-radius-s)',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '...' : 'Recrawl'}
        </button>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--theme-error-500)' }}>Failed</span>
        <button
          onClick={handleCrawl}
          disabled={loading}
          style={{
            padding: '2px 6px',
            fontSize: '12px',
            background: 'var(--theme-elevation-150)',
            border: '1px solid var(--theme-elevation-250)',
            borderRadius: 'var(--style-radius-s)',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '...' : 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: 'var(--theme-warning-500)' }}>Pending</span>
      <button
        onClick={handleCrawl}
        disabled={loading}
        style={{
          padding: '2px 6px',
          fontSize: '12px',
          background: 'var(--theme-elevation-150)',
          border: '1px solid var(--theme-elevation-250)',
          borderRadius: 'var(--style-radius-s)',
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? '...' : 'Crawl'}
      </button>
      {error && <span style={{ color: 'var(--theme-error-500)', fontSize: '11px' }}>{error}</span>}
    </div>
  )
}
