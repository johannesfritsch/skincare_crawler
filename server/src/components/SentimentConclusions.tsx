'use client'

import React, { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

interface ConclusionRecord {
  topic: string
  conclusion: 'positive' | 'negative' | 'divided'
  strength: 'low' | 'medium' | 'high' | 'ultra'
  volume?: number
}

const TOPIC_LABELS: Record<string, string> = {
  smell: 'Smell',
  texture: 'Texture',
  color: 'Color',
  consistency: 'Consistency',
  absorption: 'Absorption',
  stickiness: 'Stickiness',
  lather: 'Lather',
  efficacy: 'Efficacy',
  longevity: 'Longevity',
  finish: 'Finish',
  afterFeel: 'After Feel',
  skinTolerance: 'Skin Tolerance',
  allergenPotential: 'Allergen Risk',
  dispensing: 'Dispensing',
  travelSafety: 'Travel Safety',
  animalTesting: 'Animal Testing',
}

const CONCLUSION_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  positive: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
  negative: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  divided: { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' },
}

const STRENGTH_DOTS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  ultra: 4,
}

const STRENGTH_LABELS: Record<string, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
  ultra: 'Very high confidence',
}

export default function SentimentConclusions() {
  const { id } = useDocumentInfo()
  const [data, setData] = useState<ConclusionRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    async function fetchConclusions() {
      try {
        const res = await fetch(
          `/api/product-sentiment-conclusions?where[product][equals]=${id}&limit=100&depth=0`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setData((json.docs ?? []) as ConclusionRecord[])
      } catch {
        setData([])
      } finally {
        setLoading(false)
      }
    }

    fetchConclusions()
  }, [id])

  if (loading) {
    return (
      <div style={{ padding: '16px 0', color: 'var(--theme-elevation-500)', fontSize: 13 }}>
        Loading conclusions...
      </div>
    )
  }

  if (data.length === 0) return null

  // Group by conclusion type for visual ordering: positive first, then divided, then negative
  const order = ['positive', 'divided', 'negative'] as const
  const sorted = [...data].sort((a, b) => {
    const ai = order.indexOf(a.conclusion)
    const bi = order.indexOf(b.conclusion)
    if (ai !== bi) return ai - bi
    // Within same conclusion, sort by strength descending
    const strengths = ['ultra', 'high', 'medium', 'low']
    return strengths.indexOf(a.strength) - strengths.indexOf(b.strength)
  })

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 13,
          color: 'var(--theme-elevation-500)',
          marginBottom: 8,
        }}
      >
        Conclusions from {data.length} topics
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sorted.map((item) => {
          const style = CONCLUSION_STYLES[item.conclusion]
          const dots = STRENGTH_DOTS[item.strength]
          const label = TOPIC_LABELS[item.topic] || item.topic

          return (
            <div
              key={item.topic}
              title={`${label}: ${item.conclusion} (${STRENGTH_LABELS[item.strength]})`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 9999,
                backgroundColor: style.bg,
                border: `1px solid ${style.border}`,
                color: style.text,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'default',
              }}
            >
              <span>{label}</span>
              <span style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      backgroundColor: i < dots ? style.text : `${style.border}`,
                      opacity: i < dots ? 0.8 : 0.4,
                    }}
                  />
                ))}
              </span>
              {item.volume != null && (
                <span style={{ fontSize: 11, opacity: 0.7 }}>({item.volume})</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
