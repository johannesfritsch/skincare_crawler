'use client'

import { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

interface MentionRow {
  mentionId: number
  sceneId: number
  sceneTimestamp: number | null
  sceneImageUrl: string | null
  productId: number
  productName: string | null
  brandName: string | null
  confidence: number | null
  overallSentiment: string | null
  overallSentimentScore: number | null
  quoteCount: number
}

const sentimentColor: Record<string, string> = {
  positive: '#22c55e',
  neutral: '#a3a3a3',
  negative: '#ef4444',
  mixed: '#f59e0b',
}

function formatTimestamp(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VideoMentionsList() {
  const { id } = useDocumentInfo()
  const [mentions, setMentions] = useState<MentionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    async function fetchMentions() {
      try {
        // 1. Fetch all scenes for this video
        const scenesRes = await fetch(`/api/video-scenes?where[video][equals]=${id}&limit=500&sort=timestampStart&depth=0`)
        const scenesData = await scenesRes.json()
        const scenes = scenesData.docs as Array<{ id: number; timestampStart?: number; image?: number }>

        if (scenes.length === 0) {
          setMentions([])
          setLoading(false)
          return
        }

        // 2. Fetch all mentions for these scenes
        const sceneIds = scenes.map((s) => s.id)
        const mentionsRes = await fetch(
          `/api/video-mentions?where[videoScene][in]=${sceneIds.join(',')}&limit=500&depth=1`,
        )
        const mentionsData = await mentionsRes.json()
        const rawMentions = mentionsData.docs as Array<Record<string, unknown>>

        // 3. Build scene lookup (id → scene data)
        const sceneLookup = new Map<number, { timestampStart: number | null; imageId: number | null }>()
        for (const s of scenes) {
          sceneLookup.set(s.id, {
            timestampStart: s.timestampStart ?? null,
            imageId: s.image ?? null,
          })
        }

        // 4. Fetch scene image URLs (batch)
        const imageIds = [...new Set(scenes.map((s) => s.image).filter(Boolean))] as number[]
        const imageUrlMap = new Map<number, string>()
        if (imageIds.length > 0) {
          const imagesRes = await fetch(
            `/api/video-media?where[id][in]=${imageIds.join(',')}&limit=${imageIds.length}&select[url]=true&select[sizes]=true`,
          )
          const imagesData = await imagesRes.json()
          for (const img of imagesData.docs as Array<{ id: number; url?: string; sizes?: { thumbnail?: { url?: string } } }>) {
            const url = img.sizes?.thumbnail?.url || img.url
            if (url) imageUrlMap.set(img.id, url)
          }
        }

        // 5. Build mention rows
        const rows: MentionRow[] = rawMentions.map((m) => {
          const sceneRef = m.videoScene as number | { id: number }
          const sceneId = typeof sceneRef === 'number' ? sceneRef : sceneRef.id
          const scene = sceneLookup.get(sceneId)

          const productRef = m.product as number | { id: number; name?: string; brand?: number | { name?: string } } | null
          let productId = 0
          let productName: string | null = null
          let brandName: string | null = null
          if (productRef && typeof productRef === 'object') {
            productId = productRef.id
            productName = productRef.name ?? null
            const brand = productRef.brand
            if (brand && typeof brand === 'object') {
              brandName = brand.name ?? null
            }
          } else if (typeof productRef === 'number') {
            productId = productRef
          }

          const quotes = m.quotes as Array<unknown> | undefined
          const imageId = scene?.imageId
          const sceneImageUrl = imageId ? imageUrlMap.get(imageId) ?? null : null

          return {
            mentionId: m.id as number,
            sceneId,
            sceneTimestamp: scene?.timestampStart ?? null,
            sceneImageUrl,
            productId,
            productName,
            brandName,
            confidence: (m.confidence as number) ?? null,
            overallSentiment: (m.overallSentiment as string) ?? null,
            overallSentimentScore: (m.overallSentimentScore as number) ?? null,
            quoteCount: quotes?.length ?? 0,
          }
        })

        rows.sort((a, b) => (a.sceneTimestamp ?? 0) - (b.sceneTimestamp ?? 0))
        setMentions(rows)
      } catch (err) {
        console.error('Failed to fetch video mentions', err)
      } finally {
        setLoading(false)
      }
    }

    fetchMentions()
  }, [id])

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--theme-elevation-500)', fontSize: '13px' }}>
        Loading mentions...
      </div>
    )
  }

  if (mentions.length === 0) {
    return (
      <div style={{ padding: '24px', color: 'var(--theme-elevation-500)', fontSize: '13px' }}>
        No product mentions found. Run the video processing pipeline to detect products and extract sentiment.
      </div>
    )
  }

  return (
    <div style={{ padding: '0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {mentions.map((m) => (
          <a
            key={m.mentionId}
            href={`/admin/collections/video-mentions/${m.mentionId}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 12px',
              background: 'var(--theme-elevation-50)',
              borderRadius: '6px',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--theme-elevation-100)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--theme-elevation-50)' }}
          >
            {/* Scene thumbnail */}
            <div style={{
              width: '56px',
              height: '42px',
              borderRadius: '4px',
              overflow: 'hidden',
              background: 'var(--theme-elevation-150)',
              flexShrink: 0,
              position: 'relative',
            }}>
              {m.sceneImageUrl ? (
                <img
                  src={m.sceneImageUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--theme-elevation-400)' }}>
                  —
                </div>
              )}
              {/* Timestamp badge */}
              <div style={{
                position: 'absolute',
                bottom: '2px',
                right: '2px',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                fontSize: '9px',
                padding: '1px 4px',
                borderRadius: '2px',
                lineHeight: 1.2,
              }}>
                {formatTimestamp(m.sceneTimestamp)}
              </div>
            </div>

            {/* Product info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.productName ?? `Product #${m.productId}`}
              </div>
              {m.brandName && (
                <div style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', marginTop: '1px' }}>
                  {m.brandName}
                </div>
              )}
            </div>

            {/* Sentiment */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {m.overallSentiment && (
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: sentimentColor[m.overallSentiment] ?? '#a3a3a3',
                }} />
              )}
              {m.overallSentimentScore != null && (
                <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-elevation-600)' }}>
                  {m.overallSentimentScore > 0 ? '+' : ''}{m.overallSentimentScore.toFixed(1)}
                </span>
              )}
              {m.quoteCount > 0 && (
                <span style={{ fontSize: '11px', color: 'var(--theme-elevation-400)' }}>
                  {m.quoteCount} quote{m.quoteCount !== 1 ? 's' : ''}
                </span>
              )}
              {m.confidence != null && (
                <span style={{ fontSize: '11px', color: 'var(--theme-elevation-400)' }}>
                  {(m.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
