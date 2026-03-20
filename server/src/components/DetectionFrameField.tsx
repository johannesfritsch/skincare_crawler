'use client'

import React, { useEffect, useState } from 'react'
import { useField, useFormFields } from '@payloadcms/ui'
import type { RelationshipFieldClientComponent } from 'payload'

/**
 * Read-only custom Field component for the `frame` relationship inside
 * video-scenes → objects[] array rows. Displays the source frame image
 * with a red bounding box overlay showing where the detection was found.
 *
 * This bypasses the Payload relationship field caching bug where all
 * array rows show the same relationship value (see payloadcms/payload#15758).
 */
const DetectionFrameField: RelationshipFieldClientComponent = (props) => {
  const { path } = props

  // Read the frame ID from THIS row's scoped path (e.g. "objects.3.frame")
  const { value: frameId } = useField<number>({ path })

  // Read sibling bounding box fields from the same array row
  // path = "objects.3.frame" → rowPrefix = "objects.3."
  const rowPrefix = path.replace(/\.frame$/, '.')
  const boxXMin = useFormFields(([f]) => f[`${rowPrefix}boxXMin`]?.value as number | undefined)
  const boxYMin = useFormFields(([f]) => f[`${rowPrefix}boxYMin`]?.value as number | undefined)
  const boxXMax = useFormFields(([f]) => f[`${rowPrefix}boxXMax`]?.value as number | undefined)
  const boxYMax = useFormFields(([f]) => f[`${rowPrefix}boxYMax`]?.value as number | undefined)

  const [imageUrl, setImageUrl] = useState<string | null>(null)
  // Original image dimensions (from the media document, not the displayed variant)
  // Bounding box coordinates are in this coordinate space
  const [origWidth, setOrigWidth] = useState(0)
  const [origHeight, setOrigHeight] = useState(0)

  // Fetch the frame document to get its image URL and original dimensions
  useEffect(() => {
    if (!frameId) {
      setImageUrl(null)
      setOrigWidth(0)
      setOrigHeight(0)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        // Fetch the frame → get image (video-media) document at depth=1
        const frameRes = await fetch(`/api/video-frames/${frameId}?depth=1`)
        if (!frameRes.ok || cancelled) return
        const frameDoc = await frameRes.json()
        const image = frameDoc.image
        if (typeof image !== 'object' || !image) return

        // Use detail variant for display (smaller/faster), original as fallback
        const url = image.sizes?.detail?.url || image.url
        // Original upload dimensions — bounding boxes are in this coordinate space
        const w = image.width as number || 0
        const h = image.height as number || 0

        if (!cancelled) {
          setImageUrl(url)
          setOrigWidth(w)
          setOrigHeight(h)
        }
      } catch {
        // silently fail — field just shows frame ID fallback
      }
    })()

    return () => { cancelled = true }
  }, [frameId])

  const hasBox = boxXMin != null && boxYMin != null && boxXMax != null && boxYMax != null

  if (!frameId) {
    return (
      <div style={{ marginBottom: 'var(--spacing-field)' }}>
        <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>Source Frame</label>
        <span style={{ color: 'var(--theme-elevation-500)' }}>No frame</span>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 'var(--spacing-field)' }}>
      <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
        Source Frame <span style={{ color: 'var(--theme-elevation-500)', fontWeight: 'normal' }}>#{frameId}</span>
      </label>
      {imageUrl ? (
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            borderRadius: 'var(--border-radius-m)',
            overflow: 'hidden',
            border: '1px solid var(--theme-elevation-150)',
          }}
        >
          <img
            src={imageUrl}
            alt={`Frame ${frameId}`}
            style={{ display: 'block', maxWidth: '100%', maxHeight: 300 }}
          />
          {hasBox && origWidth > 0 && origHeight > 0 && (
            <div
              style={{
                position: 'absolute',
                left: `${(boxXMin / origWidth) * 100}%`,
                top: `${(boxYMin / origHeight) * 100}%`,
                width: `${((boxXMax - boxXMin) / origWidth) * 100}%`,
                height: `${((boxYMax - boxYMin) / origHeight) * 100}%`,
                border: '2px solid #ff3333',
                borderRadius: 2,
                pointerEvents: 'none',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
              }}
            />
          )}
        </div>
      ) : (
        <span style={{ color: 'var(--theme-elevation-500)' }}>Frame #{frameId}</span>
      )}
    </div>
  )
}

export default DetectionFrameField
