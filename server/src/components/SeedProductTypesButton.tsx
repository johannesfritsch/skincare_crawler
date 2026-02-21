'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { seedProductTypes } from '@/actions/seed-product-types'

export default function SeedProductTypesButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSeed = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const result = await seedProductTypes()
      if (result.success) {
        setMessage(result.message)
        router.refresh()
      } else {
        setError('Failed to seed product types')
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
        onClick={handleSeed}
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
        {loading ? 'Loading...' : 'Load Defaults'}
      </button>
      {message && (
        <div style={{ color: 'var(--theme-success-500)', marginTop: '8px', fontSize: '14px' }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--theme-error-500)', marginTop: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
