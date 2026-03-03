'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { seedProductTypes } from '@/actions/seed-product-types'

export default function SeedProductTypesButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSeed = async () => {
    setLoading(true)
    try {
      await seedProductTypes()
      router.refresh()
    } catch (err) {
      console.error('Failed to seed product types', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleSeed}
      className="popup-button-list__button"
      style={{ whiteSpace: 'nowrap', opacity: loading ? 0.5 : 1 }}
    >
      {loading ? 'Loading...' : 'Load Defaults'}
    </button>
  )
}
