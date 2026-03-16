'use client'

import React, { useState, useEffect, useCallback } from 'react'
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

function SceneCard({ scene, onOpen }: { scene: Scene; onOpen: (id: number) => void }) {
  const img = scene.image
  const src =
    img && typeof img !== 'number'
      ? img.sizes?.card?.url ?? img.url ?? null
      : null

  const mentions = (scene.videoMentions?.docs ?? [])
    .filter((m): m is Mention => typeof m !== 'number')
    .slice(0, 3)

  const timeRange = formatTimeRange(scene.timestampStart, scene.timestampEnd)

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
      className="scenes-gallery__item"
    >
      {src ? (
        <img
          src={src}
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
        `&select[timestampStart]=true&select[timestampEnd]=true&select[image]=true&select[videoMentions]=true`,
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
