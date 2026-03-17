'use client'

import React, { useState, useEffect } from 'react'
import type { DefaultCellComponentProps } from 'payload'
import { StoreLogo } from './store-logos'

/**
 * Custom list cell for Products: shows store logos for all linked source-products.
 */

interface SourceProduct {
  id: number
  source?: string | null
}

const cache = new Map<number, string[]>()

export default function ProductStoresCell({ rowData }: DefaultCellComponentProps) {
  const productId = rowData?.id as number | undefined
  const [sources, setSources] = useState<string[] | null>(productId ? cache.get(productId) ?? null : null)

  useEffect(() => {
    if (!productId) return
    if (cache.has(productId)) {
      setSources(cache.get(productId)!)
      return
    }

    // sourceProducts is a hasMany relationship on products — fetch with depth=1
    fetch(
      `/api/products/${productId}?depth=1&select[sourceProducts]=true`,
    )
      .then((res) => res.json())
      .then((json) => {
        const sps = (json.sourceProducts ?? []) as (SourceProduct | number)[]
        const slugs = [...new Set(
          sps
            .map((sp) => (typeof sp === 'number' ? null : sp.source))
            .filter((s): s is string => !!s),
        )]
        cache.set(productId, slugs)
        setSources(slugs)
      })
      .catch(() => {
        cache.set(productId, [])
        setSources([])
      })
  }, [productId])

  if (!sources || sources.length === 0) {
    return <span style={{ color: 'var(--theme-elevation-400)', fontSize: '12px' }}>—</span>
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {sources.map((slug) => (
        <span
          key={slug}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '18px',
            flexShrink: 0,
          }}
        >
          <StoreLogo source={slug} />
        </span>
      ))}
    </div>
  )
}
