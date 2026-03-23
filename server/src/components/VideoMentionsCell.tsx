import React from 'react'
import type { DefaultServerCellComponentProps } from 'payload'

const sentimentColor: Record<string, string> = {
  positive: '#22c55e',
  neutral: '#a3a3a3',
  negative: '#ef4444',
  mixed: '#f59e0b',
}

export default async function VideoMentionsCell({ cellData, payload }: DefaultServerCellComponentProps) {
  const joinData = cellData as { docs?: Array<number | { id: number }>; hasNextPage?: boolean } | undefined
  const docRefs = joinData?.docs
  if (!docRefs || docRefs.length === 0) {
    return <span style={{ color: 'var(--theme-elevation-400)', fontSize: '13px' }}>—</span>
  }

  const ids = docRefs.map((d) => (typeof d === 'number' ? d : d.id))

  const result = await payload.find({
    collection: 'video-mentions',
    where: { id: { in: ids } },
    depth: 1,
    limit: ids.length,
  })

  const mentions = result.docs as Array<{
    id: number
    product?: { name?: string } | number | null
    overallSentiment?: string | null
    overallSentimentScore?: number | null
  }>

  if (mentions.length === 0) {
    return <span style={{ color: 'var(--theme-elevation-400)', fontSize: '13px' }}>—</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {mentions.map((m) => {
        const productName =
          m.product && typeof m.product === 'object' ? m.product.name : null
        const sentiment = m.overallSentiment ?? null
        const score = m.overallSentimentScore ?? null

        return (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              lineHeight: 1.3,
            }}
          >
            {sentiment && (
              <span
                style={{
                  display: 'inline-block',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: sentimentColor[sentiment] ?? '#a3a3a3',
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {productName ?? `#${typeof m.product === 'number' ? m.product : m.id}`}
            </span>
            {score != null && (
              <span style={{ color: 'var(--theme-elevation-500)', fontSize: '12px', flexShrink: 0 }}>
                {score.toFixed(1)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
