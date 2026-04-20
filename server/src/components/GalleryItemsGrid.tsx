'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useDocumentDrawer, useDocumentInfo } from '@payloadcms/ui'

interface ItemImage {
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

interface GalleryItem {
  id: number
  position?: number | null
  image?: ItemImage | number | null
  galleryMentions?: {
    docs?: (Mention | number)[]
  }
}

const sentimentColor: Record<string, string> = {
  positive: '#22c55e',
  neutral: '#a3a3a3',
  negative: '#ef4444',
  mixed: '#f59e0b',
}

function resolveImageUrl(img: ItemImage | number | null | undefined, size: 'detail' | 'card'): string | null {
  if (!img || typeof img === 'number') return null
  if (size === 'detail') return img.sizes?.detail?.url ?? img.sizes?.card?.url ?? img.url ?? null
  return img.sizes?.card?.url ?? img.url ?? null
}

function ItemCard({ item, onOpen }: { item: GalleryItem; onOpen: (id: number) => void }) {
  const src = resolveImageUrl(item.image as ItemImage | number | null, 'detail')

  const mentions = (item.galleryMentions?.docs ?? [])
    .filter((m): m is Mention => typeof m !== 'number')
    .slice(0, 3)

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
      onClick={() => onOpen(item.id)}
      className="gallery-items-grid__item"
    >
      {src ? (
        <img
          src={src}
          alt={`Gallery item ${item.position ?? item.id}`}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '1',
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
      {mentions.length > 0 && (
        <div style={{ padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
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
  )
}

function ItemDrawerOpener({
  itemId,
  onClose,
}: {
  itemId: number
  onClose: () => void
}) {
  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: 'gallery-items',
    id: itemId,
  })

  useEffect(() => {
    openDrawer()
  }, [openDrawer])

  return <DocumentDrawer onSave={onClose} />
}

export default function GalleryItemsGrid() {
  const { id } = useDocumentInfo()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [openItemId, setOpenItemId] = useState<number | null>(null)
  const [drawerKey, setDrawerKey] = useState(0)

  useEffect(() => {
    if (!id) return
    fetch(
      `/api/gallery-items?where[gallery][equals]=${id}&depth=1&limit=200&sort=position` +
        `&select[position]=true&select[image]=true&select[galleryMentions]=true`,
    )
      .then((res) => res.json())
      .then((data) => setItems(data.docs ?? []))
      .catch(() => setItems([]))
  }, [id])

  const handleOpen = useCallback((itemId: number) => {
    setOpenItemId(itemId)
    setDrawerKey((k) => k + 1)
  }, [])

  const handleClose = useCallback(() => {
    setOpenItemId(null)
  }, [])

  if (!items.length) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-500)', fontSize: '14px' }}>
        No gallery items found.
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
        {items.map((item) => (
          <ItemCard key={item.id} item={item} onOpen={handleOpen} />
        ))}
      </div>
      {openItemId != null && (
        <ItemDrawerOpener key={drawerKey} itemId={openItemId} onClose={handleClose} />
      )}
      <style>{`
        .gallery-items-grid__item {
          transition: box-shadow 0.15s;
        }
        .gallery-items-grid__item:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
      `}</style>
    </div>
  )
}
