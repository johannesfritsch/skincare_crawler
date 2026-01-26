'use client'

import { useWatchForm } from '@payloadcms/ui'

export default function ItemsCountField() {
  const { getDataByPath } = useWatchForm()
  const itemsDiscovered = getDataByPath<number>('itemsDiscovered') || 0
  const itemsCrawled = getDataByPath<number>('itemsCrawled') || 0

  // Pending is discovered minus crawled (includes failed for now)
  const pending = itemsDiscovered - itemsCrawled

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
      </div>
    </div>
  )
}
