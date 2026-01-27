'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDocumentInfo, useWatchForm } from '@payloadcms/ui'

export default function AutoFillFromSourcesButton() {
  const router = useRouter()
  const { id } = useDocumentInfo()
  const { getDataByPath } = useWatchForm()
  const dmProduct = getDataByPath<number | null>('dmProduct')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSource = !!dmProduct
  // Add more source checks here: || !!otherSource

  const handleAutoFill = async () => {
    if (!id) {
      setError('Product must be saved first')
      return
    }

    if (!hasSource) {
      setError('No source linked. Please link a DM Product in the Sources tab first.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/products/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: [id] }),
      })

      const data = await response.json()

      if (data.success && data.results?.[0]?.success) {
        router.refresh()
      } else {
        setError(data.results?.[0]?.error || data.error || 'Failed to auto-fill')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <button
        onClick={handleAutoFill}
        disabled={loading}
        style={{
          padding: '8px 16px',
          background: loading ? 'var(--theme-elevation-200)' : 'var(--theme-elevation-150)',
          border: '1px solid var(--theme-elevation-300)',
          borderRadius: 'var(--style-radius-s)',
          cursor: loading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {loading ? 'Auto-filling...' : 'Auto-fill from Sources'}
      </button>
      {error && (
        <div style={{ color: 'var(--theme-error-500)', marginTop: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
