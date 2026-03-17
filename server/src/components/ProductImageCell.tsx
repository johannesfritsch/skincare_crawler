'use client'

import React, { useState, useEffect } from 'react'
import type { DefaultCellComponentProps } from 'payload'

/**
 * Custom list cell for Products: shows the first variant's public image
 * with a badge indicating total variant count.
 */

interface VariantImage {
  image?: {
    sizes?: {
      thumbnail?: { url?: string | null }
    }
    url?: string | null
  } | number | null
  visibility?: string | null
}

interface VariantDoc {
  id: number
  images?: VariantImage[]
}

interface CacheEntry {
  imgUrl: string | null
  count: number
}

const cache = new Map<number, CacheEntry>()

export default function ProductImageCell({ rowData }: DefaultCellComponentProps) {
  const productId = rowData?.id as number | undefined
  const [data, setData] = useState<CacheEntry | null>(productId ? cache.get(productId) ?? null : null)

  useEffect(() => {
    if (!productId) return
    if (cache.has(productId)) {
      setData(cache.get(productId)!)
      return
    }

    fetch(
      `/api/product-variants?where[product][equals]=${productId}&depth=1&limit=50` +
        `&select[images]=true`,
    )
      .then((res) => res.json())
      .then((json) => {
        const docs = (json.docs ?? []) as VariantDoc[]
        const count = json.totalDocs ?? docs.length

        // Find first public image across all variants
        let imgUrl: string | null = null
        for (const doc of docs) {
          if (!doc.images) continue
          const pub = doc.images.find((i) => i.visibility === 'public')
          const entry = pub ?? doc.images[0]
          const img = entry?.image
          if (img && typeof img !== 'number') {
            imgUrl = img.sizes?.thumbnail?.url ?? img.url ?? null
            if (imgUrl) break
          }
        }

        const result: CacheEntry = { imgUrl, count }
        cache.set(productId, result)
        setData(result)
      })
      .catch(() => {
        const result: CacheEntry = { imgUrl: null, count: 0 }
        cache.set(productId, result)
        setData(result)
      })
  }, [productId])

  if (!data) {
    return (
      <div style={{ width: '40px', height: '40px', borderRadius: '4px', background: 'var(--theme-elevation-100)' }} />
    )
  }

  return (
    <div style={{ position: 'relative', width: '40px', height: '40px', flexShrink: 0 }}>
      {data.imgUrl ? (
        <img
          src={data.imgUrl}
          alt=""
          style={{
            width: '40px',
            height: '40px',
            objectFit: 'contain',
            borderRadius: '4px',
            background: 'var(--theme-elevation-50)',
          }}
        />
      ) : (
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '4px',
            background: 'var(--theme-elevation-150)',
          }}
        />
      )}
      {data.count > 0 && (
        <span
          style={{
            position: 'absolute',
            bottom: '-4px',
            right: '-6px',
            fontSize: '10px',
            fontWeight: 600,
            lineHeight: 1,
            padding: '2px 4px',
            borderRadius: '9999px',
            background: 'var(--theme-elevation-800)',
            color: 'var(--theme-elevation-50)',
            whiteSpace: 'nowrap',
          }}
        >
          {data.count === 1 ? '1' : `+${data.count}`}
        </span>
      )}
    </div>
  )
}
