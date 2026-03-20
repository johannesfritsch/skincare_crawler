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
  const [videoTime, setFrameTime] = useState<number | null>(null)

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
          setFrameTime(typeof frameDoc.videoTime === 'number' ? frameDoc.videoTime : null)
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
      <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
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
          {videoTime != null && (
            <span
              style={{
                position: 'absolute',
                bottom: 6,
                left: 6,
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {Math.floor(videoTime / 60)}:{String(videoTime % 60).padStart(2, '0')}
              {frameIndex != null && ` · #${frameIndex}`}
            </span>
          )}
        </div>
      ) : (
        <span style={{ color: 'var(--theme-elevation-500)' }}>Frame #{frameId}</span>
      )}
    </div>
  )
}
