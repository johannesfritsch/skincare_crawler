'use client'

import { useDashboardState } from '../dashboard-store'
import { WidgetContainer } from './WidgetContainer'

const BUCKET_LABELS: Record<string, string> = {
  'product-media': 'Product',
  'video-media': 'Video',
  'profile-media': 'Profile',
  'brand-media': 'Brand',
  'detection-media': 'Detection',
  'ingredient-media': 'Ingredient',
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function MediaStorageClient() {
  const { snapshot } = useDashboardState()

  if (!snapshot?.mediaByBucket) {
    return (
      <div style={{ padding: '16px', color: 'var(--theme-elevation-500)', fontSize: '13px' }}>
        Loading media storage...
      </div>
    )
  }

  const buckets = snapshot.mediaByBucket as Array<{ bucket: string; fileCount: number; totalSizeBytes: number }>
  const totalFiles = buckets.reduce((sum, b) => sum + b.fileCount, 0)
  const totalSize = buckets.reduce((sum, b) => sum + b.totalSizeBytes, 0)

  return (
    <WidgetContainer>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)' }}>
          Media Storage
        </div>
        <div style={{ fontSize: '11px', color: 'var(--theme-elevation-450)' }}>
          {totalFiles.toLocaleString()} files &middot; {formatSize(totalSize)}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: '8px',
      }}>
        {buckets.map((b) => {
          const label = BUCKET_LABELS[b.bucket] || b.bucket
          const pct = totalSize > 0 ? (b.totalSizeBytes / totalSize) * 100 : 0

          return (
            <div key={b.bucket} style={{
              padding: '10px 12px',
              backgroundColor: 'var(--theme-elevation-50)',
              border: '1px solid var(--theme-elevation-100)',
              borderRadius: '4px',
            }}>
              <div style={{
                fontSize: '0.6875rem',
                fontWeight: 500,
                color: 'var(--theme-elevation-500)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: '4px',
              }}>
                {label}
              </div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                color: 'var(--theme-text)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatSize(b.totalSizeBytes)}
              </div>
              <div style={{
                fontSize: '11px',
                color: 'var(--theme-elevation-450)',
                marginTop: '2px',
              }}>
                {b.fileCount.toLocaleString()} files
              </div>
              {/* Size bar */}
              <div style={{
                marginTop: '6px',
                height: '3px',
                backgroundColor: 'var(--theme-elevation-150)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(pct, 1)}%`,
                  backgroundColor: '#3b82f6',
                  borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </WidgetContainer>
  )
}
