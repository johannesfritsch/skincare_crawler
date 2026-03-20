'use client'

import React, { useEffect, useState } from 'react'

export interface BoundingBox {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

interface FrameImageWithBoxProps {
  frameId: number | null
  box?: BoundingBox | null
  label?: string
}

/**
 * Shared presentational component: fetches a video-frame's image and renders it
 * with an optional red bounding box overlay. Used by DetectionFrameField (objects tab)
 * and RecognitionObjectField (recognitions tab).
 */
export default function FrameImageWithBox({ frameId, box, label = 'Source Frame' }: FrameImageWithBoxProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [origWidth, setOrigWidth] = useState(0)
  const [origHeight, setOrigHeight] = useState(0)
  const [frameIndex, setFrameIndex] = useState<number | null>(null)
  const [frameTime, setFrameTime] = useState<number | null>(null)

  useEffect(() => {
    if (!frameId) {
      setImageUrl(null)
      setOrigWidth(0)
      setOrigHeight(0)
      setFrameIndex(null)
      setFrameTime(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const frameRes = await fetch(`/api/video-frames/${frameId}?depth=1`)
        if (!frameRes.ok || cancelled) return
        const frameDoc = await frameRes.json()
        const image = frameDoc.image
        if (typeof image !== 'object' || !image) return

        const url = image.sizes?.detail?.url || image.url
        const w = image.width as number || 0
        const h = image.height as number || 0

        if (!cancelled) {
          setImageUrl(url)
          setOrigWidth(w)
          setOrigHeight(h)
          setFrameIndex(typeof frameDoc.frameIndex === 'number' ? frameDoc.frameIndex : null)
          setFrameTime(typeof frameDoc.frameTime === 'number' ? frameDoc.frameTime : null)
        }
      } catch {
        // silently fail
      }
    })()

    return () => { cancelled = true }
  }, [frameId])

  const hasBox = box && box.xMin != null && box.yMin != null && box.xMax != null && box.yMax != null

  if (!frameId) {
    return (
      <div style={{ marginBottom: 'var(--spacing-field)' }}>
        <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
        <span style={{ color: 'var(--theme-elevation-500)' }}>No frame</span>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 'var(--spacing-field)' }}>
      <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
        {label}
        <span style={{ color: 'var(--theme-elevation-500)', fontWeight: 'normal' }}>
          {' '}#{frameId}
          {frameTime != null && ` · ${Math.floor(frameTime / 60)}:${String(frameTime % 60).padStart(2, '0')}`}
          {frameIndex != null && ` · frame ${frameIndex}`}
        </span>
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
                left: `${(box.xMin / origWidth) * 100}%`,
                top: `${(box.yMin / origHeight) * 100}%`,
                width: `${((box.xMax - box.xMin) / origWidth) * 100}%`,
                height: `${((box.yMax - box.yMin) / origHeight) * 100}%`,
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
