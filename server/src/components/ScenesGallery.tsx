'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useDocumentDrawer, useDocumentInfo } from '@payloadcms/ui'

interface SceneImage {
  sizes?: {
    card?: { url?: string | null }
    detail?: { url?: string | null }
  }
  url?: string | null
}

interface MentionProduct {
  id: number
  name?: string | null
}

interface Mention {
  id: number
  product?: MentionProduct | number | null
  overallSentiment?: string | null
}

interface Scene {
  id: number
  timestampStart?: number | null
  timestampEnd?: number | null
  image?: SceneImage | number | null
  barcodes?: unknown[] | null
  objects?: unknown[] | null
  recognitions?: unknown[] | null
  llmMatches?: unknown[] | null
  detections?: unknown[] | null
  videoMentions?: {
    docs?: (Mention | number)[]
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTimeRange(start?: number | null, end?: number | null): string {
  if (start == null && end == null) return ''
  if (start != null && end != null) return `${formatTime(start)}–${formatTime(end)}`
  if (start != null) return formatTime(start)
  return formatTime(end!)
}

const sentimentColor: Record<string, string> = {
  positive: '#22c55e',
  neutral: '#a3a3a3',
  negative: '#ef4444',
  mixed: '#f59e0b',
}

/** Interval between frame flips on hover (ms) */
const FLIP_INTERVAL_MS = 250

function resolveImageUrl(img: SceneImage | number | null | undefined, size: 'detail' | 'card'): string | null {
  if (!img || typeof img === 'number') return null
  if (size === 'detail') return img.sizes?.detail?.url ?? img.sizes?.card?.url ?? img.url ?? null
  return img.sizes?.card?.url ?? img.url ?? null
}

/**
 * Cache of frame image URLs per scene ID.
 * Shared across all SceneCard instances to survive re-renders.
 */
const frameCache = new Map<number, string[]>()
/** Tracks in-flight fetches to avoid duplicate requests. */
const frameFetchPromises = new Map<number, Promise<string[]>>()

async function fetchFrameUrls(sceneId: number): Promise<string[]> {
  if (frameCache.has(sceneId)) return frameCache.get(sceneId)!

  // Deduplicate concurrent fetches for the same scene
  if (frameFetchPromises.has(sceneId)) return frameFetchPromises.get(sceneId)!

  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/video-frames?where[scene][equals]=${sceneId}&depth=1&limit=100&sort=id` +
          `&select[image]=true`,
      )
      if (!res.ok) return []
      const data = await res.json()
      const urls: string[] = (data.docs ?? [])
        .map((frame: { image?: SceneImage | number | null }) => {
          const img = frame.image
          if (!img || typeof img === 'number') return null
          return img.sizes?.card?.url ?? img.url ?? null
        })
        .filter(Boolean) as string[]
      frameCache.set(sceneId, urls)
      return urls
    } catch {
      return []
    } finally {
      frameFetchPromises.delete(sceneId)
    }
  })()

  frameFetchPromises.set(sceneId, promise)
  return promise
}

function SceneCard({ scene, onOpen }: { scene: Scene; onOpen: (id: number) => void }) {
  const restingSrc = resolveImageUrl(scene.image as SceneImage | number | null, 'detail')

  const [frameUrls, setFrameUrls] = useState<string[] | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mentions = (scene.videoMentions?.docs ?? [])
    .filter((m): m is Mention => typeof m !== 'number')
    .slice(0, 3)

  const timeRange = formatTimeRange(scene.timestampStart, scene.timestampEnd)

  const counts: [string, number][] = [
    ['BA', scene.barcodes?.length ?? 0],
    ['OB', scene.objects?.length ?? 0],
    ['RE', scene.recognitions?.length ?? 0],
    ['LLM', scene.llmMatches?.length ?? 0],
    ['DE', scene.detections?.length ?? 0],
    ['ME', mentions.length],
  ]
  const hasAnyCounts = counts.some(([, n]) => n > 0)

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true)
    setFrameIndex(0)

    // Lazy-load frames on first hover
    fetchFrameUrls(scene.id).then((urls) => {
      if (urls.length > 1) {
        setFrameUrls(urls)
      }
    })
  }, [scene.id])

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
    setFrameIndex(0)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Start/stop cycling when hovering state or frame URLs change
  useEffect(() => {
    if (isHovering && frameUrls && frameUrls.length > 1) {
      intervalRef.current = setInterval(() => {
        setFrameIndex((prev) => (prev + 1) % frameUrls.length)
      }, FLIP_INTERVAL_MS)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isHovering, frameUrls])

  const displaySrc = isHovering && frameUrls && frameUrls.length > 1
    ? frameUrls[frameIndex]
    : restingSrc

  const totalFrames = frameUrls?.length ?? 0

  return (
    <div
      style={{
        borderRadius: 'var(--style-radius-s)',
        overflow: 'hidden',
        border: 'none',
        cursor: 'pointer',
        background: 'var(--theme-elevation-100)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={() => onOpen(scene.id)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="scenes-gallery__item"
    >
      <div style={{ position: 'relative' }}>
        {displaySrc ? (
          <img
            src={displaySrc}
            alt={`Scene ${scene.id}`}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              aspectRatio: '16/9',
              background: 'var(--theme-elevation-200)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--theme-elevation-500)',
              fontSize: '13px',
            }}
          >
            No image
          </div>
        )}
        {/* Frame progress dots — shown during hover flip-through */}
        {isHovering && totalFrames > 1 && (
          <div
            style={{
              position: 'absolute',
              bottom: 4,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: 3,
              pointerEvents: 'none',
            }}
          >
            {frameUrls!.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === frameIndex ? 12 : 5,
                  height: 5,
                  borderRadius: 3,
                  background: i === frameIndex ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)',
                  transition: 'width 0.15s, background 0.15s',
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {timeRange && (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--theme-elevation-800)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timeRange}
          </span>
        )}
        {hasAnyCounts && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
            {counts.map(([label, n]) =>
              n > 0 ? (
                <span
                  key={label}
                  style={{
                    fontSize: '9px',
                    lineHeight: 1,
                    padding: '1px 4px',
                    borderRadius: '3px',
                    background: 'var(--theme-elevation-150)',
                    color: 'var(--theme-elevation-600)',
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.02em',
                  }}
                >
                  {label} {n}
                </span>
              ) : null,
            )}
          </div>
        )}
        {mentions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
            {mentions.map((m) => {
              const name =
                m.product && typeof m.product !== 'number'
                  ? m.product.name ?? `#${m.product.id}`
                  : typeof m.product === 'number'
                    ? `#${m.product}`
                    : null
              if (!name) return null
              const dotColor = sentimentColor[m.overallSentiment ?? ''] ?? sentimentColor.neutral
              return (
                <span
                  key={m.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    lineHeight: 1,
                    padding: '2px 6px',
                    borderRadius: '9999px',
                    background: 'var(--theme-elevation-200)',
                    color: 'var(--theme-elevation-800)',
                    maxWidth: '100%',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {name}
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SceneDrawerOpener({
  sceneId,
  onClose,
}: {
  sceneId: number
  onClose: () => void
}) {
  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: 'video-scenes',
    id: sceneId,
  })

  useEffect(() => {
    openDrawer()
  }, [openDrawer])

  return <DocumentDrawer onSave={onClose} />
}

export default function ScenesGallery() {
  const { id } = useDocumentInfo()
  const [scenes, setScenes] = useState<Scene[]>([])
  const [openSceneId, setOpenSceneId] = useState<number | null>(null)
  const [drawerKey, setDrawerKey] = useState(0)

  useEffect(() => {
    if (!id) return
    fetch(
      `/api/video-scenes?where[video][equals]=${id}&depth=1&limit=200&sort=timestampStart` +
        `&select[timestampStart]=true&select[timestampEnd]=true&select[image]=true` +
        `&select[barcodes]=true&select[objects]=true&select[recognitions]=true` +
        `&select[llmMatches]=true&select[detections]=true&select[videoMentions]=true`,
    )
      .then((res) => res.json())
      .then((data) => setScenes(data.docs ?? []))
      .catch(() => setScenes([]))
  }, [id])

  const handleOpen = useCallback((sceneId: number) => {
    setOpenSceneId(sceneId)
    setDrawerKey((k) => k + 1)
  }, [])

  const handleClose = useCallback(() => {
    setOpenSceneId(null)
  }, [])

  if (!scenes.length) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-500)', fontSize: '14px' }}>
        No scenes found.
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
        }}
      >
        {scenes.map((scene) => (
          <SceneCard key={scene.id} scene={scene} onOpen={handleOpen} />
        ))}
      </div>
      {openSceneId != null && (
        <SceneDrawerOpener key={drawerKey} sceneId={openSceneId} onClose={handleClose} />
      )}
      <style>{`
        .scenes-gallery__item {
          transition: box-shadow 0.15s;
        }
        .scenes-gallery__item:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
      `}</style>
    </div>
  )
}
