'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useDocumentDrawer, useDocumentInfo } from '@payloadcms/ui'

interface VariantImage {
  image?: {
    sizes?: {
      detail?: { url?: string | null }
      card?: { url?: string | null }
      thumbnail?: { url?: string | null }
    }
    url?: string | null
  } | number | null
  visibility?: string | null
}

interface Variant {
  id: number
  label?: string | null
  gtin?: string | null
  images?: VariantImage[]
}

function getPublicImageUrl(images?: VariantImage[]): string | null {
  if (!images || images.length === 0) return null
  const publicEntry = images.find((i) => i.visibility === 'public')
  const entry = publicEntry ?? images[0]
  const img = entry?.image
  if (!img || typeof img === 'number') return null
  return img.sizes?.detail?.url ?? img.sizes?.card?.url ?? img.url ?? null
}

function VariantCard({ variant, onOpen }: { variant: Variant; onOpen: (id: number) => void }) {
  const src = getPublicImageUrl(variant.images)

  return (
    <div
      style={{
        borderRadius: 'var(--style-radius-s)',
        overflow: 'hidden',
        cursor: 'pointer',
        background: 'var(--theme-elevation-100)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={() => onOpen(variant.id)}
      className="variants-gallery__item"
    >
      {src ? (
        <img
          src={src}
          alt={variant.label || variant.gtin || `Variant ${variant.id}`}
          style={{
            display: 'block',
            width: '100%',
            aspectRatio: '1/1',
            objectFit: 'contain',
            background: 'var(--theme-elevation-50)',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '1/1',
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
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {variant.label && (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--theme-elevation-800)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {variant.label}
          </span>
        )}
        {variant.gtin && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--theme-elevation-500)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {variant.gtin}
          </span>
        )}
      </div>
    </div>
  )
}

function VariantDrawerOpener({
  variantId,
  onClose,
}: {
  variantId: number
  onClose: () => void
}) {
  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: 'product-variants',
    id: variantId,
  })

  useEffect(() => {
    openDrawer()
  }, [openDrawer])

  return <DocumentDrawer onSave={onClose} />
}

export default function VariantsGallery() {
  const { id } = useDocumentInfo()
  const [variants, setVariants] = useState<Variant[]>([])
  const [loading, setLoading] = useState(true)
  const [openVariantId, setOpenVariantId] = useState<number | null>(null)
  const [drawerKey, setDrawerKey] = useState(0)

  useEffect(() => {
    if (!id) { setLoading(false); return }
    setLoading(true)
    fetch(
      `/api/product-variants?where[product][equals]=${id}&depth=1&limit=200&sort=createdAt` +
        `&select[label]=true&select[gtin]=true&select[images]=true`,
    )
      .then((res) => res.json())
      .then((data) => setVariants(data.docs ?? []))
      .catch(() => setVariants([]))
      .finally(() => setLoading(false))
  }, [id])

  const handleOpen = useCallback((variantId: number) => {
    setOpenVariantId(variantId)
    setDrawerKey((k) => k + 1)
  }, [])

  const handleClose = useCallback(() => {
    setOpenVariantId(null)
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '14px' }}>
        Loading variants...
      </div>
    )
  }

  if (!variants.length) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-500)', fontSize: '14px' }}>
        No variants found.
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
        {variants.map((variant) => (
          <VariantCard key={variant.id} variant={variant} onOpen={handleOpen} />
        ))}
      </div>
      {openVariantId != null && (
        <VariantDrawerOpener key={drawerKey} variantId={openVariantId} onClose={handleClose} />
      )}
      <style>{`
        .variants-gallery__item {
          transition: box-shadow 0.15s;
        }
        .variants-gallery__item:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
      `}</style>
    </div>
  )
}
