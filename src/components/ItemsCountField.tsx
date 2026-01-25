'use client'

import { useWatchForm } from '@payloadcms/ui'

type Item = {
  gtin: string
  status?: 'pending' | 'crawled' | 'failed' | null
}

export default function ItemsCountField() {
  const { getDataByPath } = useWatchForm()
  const items = getDataByPath<Item[]>('items') || []

  const itemsArray = Array.isArray(items) ? items : []
  const pending = itemsArray.filter((item) => item.status === 'pending').length
  const crawled = itemsArray.filter((item) => item.status === 'crawled').length
  const failed = itemsArray.filter((item) => item.status === 'failed').length
  const total = itemsArray.length

  return (
    <div style={{ padding: '12px 0' }}>
      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
        Items Summary
      </label>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 10px', background: 'var(--theme-elevation-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{total}</strong> total
        </div>
        <div style={{ padding: '6px 10px', background: 'var(--theme-warning-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{pending}</strong> pending
        </div>
        <div style={{ padding: '6px 10px', background: 'var(--theme-success-100)', borderRadius: 'var(--style-radius-s)' }}>
          <strong>{crawled}</strong> crawled
        </div>
        {failed > 0 && (
          <div style={{ padding: '6px 10px', background: 'var(--theme-error-100)', borderRadius: 'var(--style-radius-s)' }}>
            <strong>{failed}</strong> failed
          </div>
        )}
      </div>
    </div>
  )
}
