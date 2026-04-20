'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useConfig, Link } from '@payloadcms/ui'

interface VideoDoc {
  id: number
  title?: string | null
  status?: string | null
  duration?: number | null
  publishedAt?: string | null
  thumbnail?: { url?: string | null; sizes?: { card?: { url?: string | null } } } | number | null
  channel?: {
    id: number
    platform?: string | null
    image?: { url?: string | null; sizes?: { avatar?: { url?: string | null } } } | number | null
    creator?: { id: number; name?: string | null } | number | null
  } | number | null
}

interface SceneImage {
  id: number
  image?: { sizes?: { card?: { url?: string | null } }; url?: string | null } | number | null
}

const FLIP_INTERVAL_MS = 300

const sceneCache = new Map<number, string[]>()
const sceneFetchPromises = new Map<number, Promise<string[]>>()

async function fetchSceneImages(videoId: number): Promise<string[]> {
  if (sceneCache.has(videoId)) return sceneCache.get(videoId)!
  if (sceneFetchPromises.has(videoId)) return sceneFetchPromises.get(videoId)!

  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/video-scenes?where[video][equals]=${videoId}&depth=1&limit=50&sort=timestampStart&select[image]=true`
      )
      if (!res.ok) return []
      const data = await res.json()
      const urls: string[] = (data.docs ?? [])
        .map((s: SceneImage) => {
          const img = s.image
          if (!img || typeof img === 'number') return null
          return img.sizes?.card?.url ?? img.url ?? null
        })
        .filter(Boolean) as string[]
      sceneCache.set(videoId, urls)
      return urls
    } catch {
      return []
    } finally {
      sceneFetchPromises.delete(videoId)
    }
  })()

  sceneFetchPromises.set(videoId, promise)
  return promise
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

const statusColors: Record<string, { bg: string; text: string }> = {
  discovered: { bg: 'var(--theme-elevation-200)', text: 'var(--theme-elevation-600)' },
  crawled: { bg: '#dbeafe', text: '#1e40af' },
  processed: { bg: '#dcfce7', text: '#166534' },
}

function PlatformIcon({ platform }: { platform: string }) {
  const size = 12
  const color = 'var(--theme-elevation-400)'
  switch (platform) {
    case 'youtube':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }}>
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.75 15.5V8.5l6.25 3.5-6.25 3.5Z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="17.5" cy="6.5" r="1.5" fill={color} stroke="none" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }}>
          <path d="M19.3 6.4a4.8 4.8 0 0 1-3-1.2A4.8 4.8 0 0 1 14.5 2h-3.2v13.7a2.9 2.9 0 0 1-2.9 2.8 2.9 2.9 0 0 1-2.9-2.8 2.9 2.9 0 0 1 2.9-2.9c.3 0 .6 0 .9.1V9.6a6.2 6.2 0 0 0-.9-.1 6.1 6.1 0 0 0-6.1 6.2A6.1 6.1 0 0 0 8.4 22a6.1 6.1 0 0 0 6.1-6.1V9.4a8 8 0 0 0 4.8 1.6V7.8c-.3 0-1.4-.2-2-1.4h2V6.4Z" />
        </svg>
      )
    default:
      return null
  }
}

function VideoCard({ video, adminRoute }: { video: VideoDoc; adminRoute: string }) {
  const [sceneUrls, setSceneUrls] = useState<string[] | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const thumbnailUrl = video.thumbnail && typeof video.thumbnail !== 'number'
    ? (video.thumbnail.sizes?.card?.url ?? video.thumbnail.url ?? null)
    : null

  const channel = video.channel && typeof video.channel !== 'number' ? video.channel : null
  const channelAvatar = channel?.image && typeof channel.image !== 'number'
    ? (channel.image.sizes?.avatar?.url ?? channel.image.url ?? null)
    : null
  const creatorName = channel?.creator && typeof channel.creator !== 'number'
    ? channel.creator.name
    : null

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true)
    setFrameIndex(0)
    fetchSceneImages(video.id).then((urls) => {
      setSceneUrls(urls)
    })
  }, [video.id])

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
    setFrameIndex(0)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    if (isHovering && sceneUrls && sceneUrls.length > 1) {
      intervalRef.current = setInterval(() => {
        setFrameIndex((prev) => (prev + 1) % sceneUrls.length)
      }, FLIP_INTERVAL_MS)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isHovering, sceneUrls])

  const displaySrc = isHovering && sceneUrls && sceneUrls.length > 0
    ? sceneUrls[frameIndex] ?? thumbnailUrl
    : thumbnailUrl

  const noScenes = isHovering && sceneUrls !== null && sceneUrls.length === 0


  const totalFrames = sceneUrls?.length ?? 0
  const status = video.status ?? 'discovered'
  const statusStyle = statusColors[status] ?? statusColors.discovered

  return (
    <Link
      href={`${adminRoute}/collections/videos/${video.id}`}
      prefetch={false}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div
        className="videos-gallery__card"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          borderRadius: 'var(--style-radius-s)',
          overflow: 'hidden',
          background: 'var(--theme-elevation-100)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Thumbnail / scene flipper */}
        <div style={{ position: 'relative', height: '200px', background: 'var(--theme-elevation-200)' }}>
          {displaySrc ? (
            <img
              src={displaySrc}
              alt={video.title ?? ''}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--theme-elevation-400)', fontSize: '13px',
            }}>
              No thumbnail
            </div>
          )}

          {/* Status badge — top right */}
          <span style={{
            position: 'absolute', top: '6px', right: '6px',
            fontSize: '9px', fontWeight: 600, textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: '9999px',
            background: statusStyle.bg, color: statusStyle.text,
          }}>
            {status}
          </span>

          {/* Duration badge */}
          {video.duration != null && video.duration > 0 && (
            <span style={{
              position: 'absolute', bottom: '6px', right: '6px',
              background: 'rgba(0,0,0,0.75)', color: '#fff',
              fontSize: '11px', fontWeight: 600, padding: '1px 5px',
              borderRadius: '4px', fontVariantNumeric: 'tabular-nums',
            }}>
              {formatDuration(video.duration)}
            </span>
          )}

          {/* No scenes hint */}
          {noScenes && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.4)', pointerEvents: 'none',
            }}>
              <span style={{
                fontSize: '11px', color: 'rgba(255,255,255,0.85)',
                padding: '3px 10px', borderRadius: '9999px',
                background: 'rgba(0,0,0,0.5)', fontWeight: 500,
              }}>
                Not processed yet
              </span>
            </div>
          )}

          {/* Frame progress dots */}
          {isHovering && totalFrames > 1 && (
            <div style={{
              position: 'absolute', bottom: 6, left: 0, right: 0,
              display: 'flex', justifyContent: 'center', gap: 3, pointerEvents: 'none',
            }}>
              {sceneUrls!.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === frameIndex ? 12 : 5,
                    height: 5, borderRadius: 3,
                    background: i === frameIndex ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)',
                    transition: 'width 0.15s, background 0.15s',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Info area */}
        <div style={{ padding: '8px 10px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          {/* Channel avatar */}
          {channelAvatar && (
            <img
              src={channelAvatar}
              alt={creatorName ?? ''}
              style={{
                width: '28px', height: '28px', borderRadius: '50%',
                objectFit: 'cover', flexShrink: 0, marginTop: '2px',
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Title — fixed 2-line height */}
            <div style={{
              fontSize: '13px', fontWeight: 500, lineHeight: '1.3',
              color: 'var(--theme-text)',
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              height: 'calc(2 * 1.3em)',
            }}>
              {video.title ?? 'Untitled'}
            </div>
            {/* Channel name + platform */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
              {channel?.platform && (
                <PlatformIcon platform={channel.platform} />
              )}
              {creatorName && (
                <span style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {creatorName}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function VideosGallery() {
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const [videos, setVideos] = useState<VideoDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/videos?depth=2&limit=50&sort=-publishedAt`)
      .then((res) => res.json())
      .then((data) => setVideos(data.docs ?? []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: '20px', color: 'var(--theme-elevation-500)' }}>Loading...</div>
  }

  if (!videos.length) {
    return <div style={{ padding: '20px', color: 'var(--theme-elevation-500)' }}>No videos found.</div>
  }

  return (
    <div style={{ padding: '0 0 20px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
      }}>
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} adminRoute={adminRoute} />
        ))}
      </div>
      <style>{`
        .videos-gallery__card {
          transition: box-shadow 0.15s, transform 0.15s;
        }
        .videos-gallery__card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  )
}
