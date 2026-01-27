'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDocumentInfo } from '@payloadcms/ui'

export default function RecrawlIngredientButton() {
  const router = useRouter()
  const { id } = useDocumentInfo()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEnrich = async () => {
    if (!id) {
      setError('No ingredient ID found')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/ingredients/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientIds: [id] }),
      })

      const data = await response.json()

      if (data.success) {
        router.refresh()
      } else {
        setError(data.error || 'Failed to enrich ingredient')
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
        onClick={handleEnrich}
        disabled={loading || !id}
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
        {loading ? 'Enriching...' : 'Enrich from SpecialChem'}
      </button>
      {error && (
        <div style={{ color: 'var(--theme-error-500)', marginTop: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
