'use client'

import { useEffect, useState, useCallback } from 'react'

interface ProgressData {
  done: number
  active: number
  total: number
}

export default function WorkItemsProgress() {
  const [data, setData] = useState<ProgressData | null>(null)

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch('/api/work-items/progress')
      if (res.ok) {
        const d = await res.json()
        setData(d.total > 0 ? d : null)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchProgress()
    const interval = setInterval(fetchProgress, 5000)
    return () => clearInterval(interval)
  }, [fetchProgress])

  if (!data) return null

  const percent = data.total > 0 ? Math.round(100 * data.done / data.total) : 0

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '0 4px', marginRight: '4px',
    }}>
      <span style={{
        fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap',
        color: 'var(--theme-elevation-500)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {data.done}/{data.total}
      </span>
      <div style={{
        width: '50px', height: '3px',
        backgroundColor: 'var(--theme-elevation-200)',
        borderRadius: '2px', overflow: 'hidden',
      }}>
        <div style={{
          width: `${percent}%`, height: '100%',
          backgroundColor: data.active > 0 ? '#059669' : 'var(--theme-elevation-400)',
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  )
}
