'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDocumentInfo, useWatchForm } from '@payloadcms/ui'

export default function DiscoverButton() {
  const router = useRouter()
  const { id } = useDocumentInfo()
  const { getDataByPath } = useWatchForm()
  const status = getDataByPath<string>('status')
  const sourceUrl = getDataByPath<string>('sourceUrl')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canDiscover = status === 'pending' && sourceUrl

  const handleDiscover = async () => {
    if (!id || !sourceUrl) {
      setError('Save the crawl with a source URL first')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/sources/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crawlId: id }),
      })

      const data = await response.json()

      if (data.success) {
        router.refresh()
      } else {
        setError(data.error || 'Failed to discover')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (!canDiscover) {
    return null
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <button
        onClick={handleDiscover}
        disabled={loading}
        style={{
          padding: '8px 16px',
          background: loading ? 'var(--theme-elevation-200)' : 'var(--theme-success-500)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--style-radius-s)',
          cursor: loading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {loading ? 'Discovering...' : 'Start Discovery'}
      </button>
      {error && (
        <div style={{ color: 'var(--theme-error-500)', marginTop: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
