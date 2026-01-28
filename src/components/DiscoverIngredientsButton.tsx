'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DiscoverIngredientsButton() {
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ discovered: number; created: number; existing: number } | null>(null)

  const handleDiscover = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/ingredients/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (data.success) {
        setResult({ discovered: data.discovered, created: data.created, existing: data.existing })
        router.refresh()
      } else {
        setError(data.error || 'Failed to discover ingredients')
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
        onClick={handleDiscover}
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
        {loading ? 'Discovering...' : 'Discover Ingredients from SpecialChem'}
      </button>
      {error && (
        <div style={{ color: 'var(--theme-error-500)', marginTop: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ color: 'var(--theme-success-500)', marginTop: '8px', fontSize: '14px' }}>
          Discovered {result.discovered} ingredients. Created {result.created}, {result.existing} already existed.
        </div>
      )}
    </div>
  )
}
