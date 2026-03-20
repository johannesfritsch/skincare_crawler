'use client'

import React, { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

interface FrameImage {
  sizes?: {
    detail?: { url?: string | null }
  }
  url?: string | null
}

interface Frame {
  id: number
  image?: FrameImage | number | null
  isClusterRepresentative?: boolean | null
  frameIndex?: number | null
  videoTime?: number | null
}

export default function FramesGallery() {
  const { id } = useDocumentInfo()
  const [frames, setFrames] = useState<Frame[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(
      `/api/video-frames?where[scene][equals]=${id}&depth=1&limit=100&sort=frameIndex&select[image]=true&select[isClusterRepresentative]=true&select[frameIndex]=true&select[videoTime]=true`,
    )
      .then((res) => res.json())
      .then((data) => setFrames(data.docs ?? []))
      .catch(() => setFrames([]))
  }, [id])

  if (!frames.length) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-500)', fontSize: '14px' }}>
        No frames found.
      </div>
    )
  }

  const getImageUrl = (frame: Frame): string | null => {
    const img = frame.image
    if (!img || typeof img === 'number') return null
    return img.sizes?.detail?.url ?? img.url ?? null
  }

  const expandedFrame = expandedId != null ? frames.find((f) => f.id === expandedId) : null

  return (
    <div style={{ padding: '12px 0' }}>
      {/* Lightbox overlay */}
      {expandedFrame && (() => {
        const src = getImageUrl(expandedFrame)
        if (!src) return null
        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              background: 'rgba(0,0,0,0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            onClick={() => setExpandedId(null)}
          >
            <div
              style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={src}
                alt={`Frame ${expandedFrame.id}`}
                style={{
                  display: 'block',
                  maxWidth: '90vw',
                  maxHeight: '90vh',
                  objectFit: 'contain',
                  borderRadius: '6px',
                }}
              />
              <a
                href={`/admin/collections/video-frames/${expandedFrame.id}`}
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  right: '12px',
                  background: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  fontSize: '13px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  textDecoration: 'none',
                }}
              >
                Open record
              </a>
              <button
                onClick={() => setExpandedId(null)}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  lineHeight: '28px',
                  textAlign: 'center',
                }}
              >
                ×
              </button>
            </div>
          </div>
        )
      })()}

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
        }}
      >
        {frames.map((frame) => {
          const src = getImageUrl(frame)
          if (!src) return null

          return (
            <div
              key={frame.id}
              style={{
                position: 'relative',
                borderRadius: 'var(--style-radius-s)',
                overflow: 'hidden',
                border: frame.isClusterRepresentative
                  ? '2px solid var(--theme-success-500)'
                  : '1px solid var(--theme-elevation-300)',
                cursor: 'pointer',
                background: 'var(--theme-elevation-100)',
              }}
              onClick={() => setExpandedId(frame.id)}
              className="frames-gallery__item"
            >
              <img
                src={src}
                alt={`Frame ${frame.id}`}
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
              {frame.videoTime != null && (
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
                  {Math.floor(frame.videoTime / 60)}:{String(frame.videoTime % 60).padStart(2, '0')}
                  {frame.frameIndex != null && ` · #${frame.frameIndex}`}
                </span>
              )}
              <a
                href={`/admin/collections/video-frames/${frame.id}`}
                onClick={(e) => e.stopPropagation()}
                className="frames-gallery__open-link"
              >
                Open
              </a>
            </div>
          )
        })}
      </div>
      <style>{`
        .frames-gallery__open-link {
          position: absolute;
          top: 6px;
          right: 6px;
          background: rgba(0,0,0,0.6);
          color: #fff;
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 4px;
          text-decoration: none;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .frames-gallery__item:hover .frames-gallery__open-link {
          opacity: 1;
        }
      `}</style>
    </div>
  )
}
