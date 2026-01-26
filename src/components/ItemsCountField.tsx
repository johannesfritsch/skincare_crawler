'use client'

import { useEffect, useState } from 'react'
import { useDocumentInfo, useWatchForm } from '@payloadcms/ui'

export default function ItemsCountField() {
  const { getDataByPath } = useWatchForm()
  const { id } = useDocumentInfo()
  const itemsDiscovered = getDataByPath<number>('itemsDiscovered') || 0
  const itemsCrawled = getDataByPath<number>('itemsCrawled') || 0

  const [failedCount, setFailedCount] = useState(0)

  useEffect(() => {
    if (!id) return

    fetch(`/api/dm-crawl-items?where[crawl][equals]=${id}&where[status][equals]=failed&limit=0`)
      .then((res) => res.json())
      .then((data) => setFailedCount(data.totalDocs || 0))
      .catch(() => setFailedCount(0))
  }, [id, itemsCrawled])

  const pending = itemsDiscovered - itemsCrawled - failedCount

  return (
    <div style={{ padding: '12px 0' }}>
      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
        Items Summary
      </label>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 10px', background: 'var(--theme-elevation-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{itemsDiscovered}</strong> total
        </div>
        <div style={{ padding: '6px 10px', background: 'var(--theme-warning-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{pending}</strong> pending
        </div>
        <div style={{ padding: '6px 10px', background: 'var(--theme-success-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{itemsCrawled}</strong> crawled
        </div>
        <div style={{ padding: '6px 10px', background: 'var(--theme-error-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{failedCount}</strong> failed
        </div>
      </div>
    </div>
  )
}
