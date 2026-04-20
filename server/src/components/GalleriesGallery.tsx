'use client'

import React, { useState, useEffect } from 'react'
import { useConfig, Link } from '@payloadcms/ui'

interface GalleryDoc {
  id: number
  caption?: string | null
  status?: string | null
  publishedAt?: string | null
  channel?: {
    id: number
    platform?: string | null
    image?: { url?: string | null; sizes?: { avatar?: { url?: string | null } } } | number | null
    creator?: { id: number; name?: string | null } | number | null
  } | number | null
  galleryItems?: {
    docs?: Array<{
      id: number
      image?: { url?: string | null; sizes?: { card?: { url?: string | null } } } | number | null
    } | number>
  }
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

/**
 * Renders gallery item images in a fixed-size mosaic grid.
 * Layouts adapt based on image count: 1 (full), 2 (split), 3 (1 big + 2 small), 4+ (2x2 grid).
 */
function ImageMosaic({ images }: { images: string[] }) {
  if (images.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--theme-elevation-400)', fontSize: '13px',
      }}>
        No images
      </div>
    )
  }

  if (images.length === 1) {
    return (
      <img src={images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    )
  }

  if (images.length === 2) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', width: '100%', height: '100%', gap: '1px' }}>
        {images.slice(0, 2).map((url, i) => (
          <img key={i} src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ))}
      </div>
    )
  }

  if (images.length === 3) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', width: '100%', height: '100%', gap: '1px' }}>
        <img src={images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', gridRow: '1 / 3' }} />
        <img src={images[1]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <img src={images[2]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }

  // 4+ images: 2x2 grid with overflow count
  const showImages = images.slice(0, 4)
  const overflow = images.length - 4

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', width: '100%', height: '100%', gap: '1px' }}>
      {showImages.map((url, i) => (
        <div key={i} style={{ position: 'relative', overflow: 'hidden' }}>
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {i === 3 && overflow > 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.45)',
              color: '#fff', fontSize: '14px', fontWeight: 600,
            }}>
              +{overflow}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function GalleryCard({ gallery, images, adminRoute }: { gallery: GalleryDoc; images: string[]; adminRoute: string }) {
  const channel = gallery.channel && typeof gallery.channel !== 'number' ? gallery.channel : null
  const channelAvatar = channel?.image && typeof channel.image !== 'number'
    ? (channel.image.sizes?.avatar?.url ?? channel.image.url ?? null)
    : null
  const creatorName = channel?.creator && typeof channel.creator !== 'number'
    ? channel.creator.name
    : null

  const status = gallery.status ?? 'discovered'
  const statusStyle = statusColors[status] ?? statusColors.discovered

  return (
    <Link
      href={`${adminRoute}/collections/galleries/${gallery.id}`}
      prefetch={false}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div
        className="galleries-gallery__card"
        style={{
          borderRadius: 'var(--style-radius-s)',
          overflow: 'hidden',
          background: 'var(--theme-elevation-100)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Image mosaic */}
        <div style={{ position: 'relative', height: '200px', background: 'var(--theme-elevation-200)' }}>
          <ImageMosaic images={images} />

          {/* Status badge — top right */}
          <span style={{
            position: 'absolute', top: '6px', right: '6px',
            fontSize: '9px', fontWeight: 600, textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: '9999px',
            background: statusStyle.bg, color: statusStyle.text,
          }}>
            {status}
          </span>

          {/* Image count badge */}
          {images.length > 0 && (
            <span style={{
              position: 'absolute', bottom: '6px', right: '6px',
              background: 'rgba(0,0,0,0.75)', color: '#fff',
              fontSize: '11px', fontWeight: 600, padding: '1px 5px',
              borderRadius: '4px', fontVariantNumeric: 'tabular-nums',
            }}>
              {images.length} {images.length === 1 ? 'image' : 'images'}
            </span>
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
            {/* Caption */}
            <div style={{
              fontSize: '13px', fontWeight: 500, lineHeight: '1.3',
              color: 'var(--theme-text)',
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              height: 'calc(2 * 1.3em)',
            }}>
              {gallery.caption ?? 'No caption'}
            </div>
            {/* Channel + platform */}
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

export default function GalleriesGallery() {
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const [galleries, setGalleries] = useState<GalleryDoc[]>([])
  const [itemImages, setItemImages] = useState<Record<number, string[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/galleries?depth=2&limit=50&sort=-publishedAt`)
      .then((res) => res.json())
      .then(async (data) => {
        const docs = data.docs ?? []
        setGalleries(docs)

        // Fetch gallery-items images in parallel
        const ids = docs.map((g: GalleryDoc) => g.id)
        if (ids.length > 0) {
          try {
            const itemsRes = await fetch(
              `/api/gallery-items?depth=1&limit=200&sort=orderIndex` +
              `&where[gallery][in]=${ids.join(',')}`
            )
            const itemsData = await itemsRes.json()
            const byGallery: Record<number, string[]> = {}
            for (const item of itemsData.docs ?? []) {
              const galleryId = typeof item.gallery === 'number' ? item.gallery : item.gallery?.id
              if (!galleryId) continue
              const img = item.image
              const url = img && typeof img !== 'number'
                ? (img.sizes?.card?.url ?? img.url ?? null)
                : null
              if (url) {
                if (!byGallery[galleryId]) byGallery[galleryId] = []
                byGallery[galleryId].push(url)
              }
            }
            setItemImages(byGallery)
          } catch { /* non-critical */ }
        }
      })
      .catch(() => setGalleries([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: '20px', color: 'var(--theme-elevation-500)' }}>Loading...</div>
  }

  if (!galleries.length) {
    return <div style={{ padding: '20px', color: 'var(--theme-elevation-500)' }}>No galleries found.</div>
  }

  return (
    <div style={{ padding: '0 0 20px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
      }}>
        {galleries.map((gallery) => (
          <GalleryCard key={gallery.id} gallery={gallery} images={itemImages[gallery.id] ?? []} adminRoute={adminRoute} />
        ))}
      </div>
      <style>{`
        .galleries-gallery__card {
          transition: box-shadow 0.15s, transform 0.15s;
        }
        .galleries-gallery__card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  )
}
