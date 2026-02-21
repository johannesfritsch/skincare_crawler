'use client'

import { useState, useEffect } from 'react'
import { useFormFields } from '@payloadcms/ui'

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

export default function EmbeddedSnippetPlayer() {
  const videoField = useFormFields(([fields]) => fields['video']?.value as { id?: number; externalUrl?: string } | number | undefined)
  const timestampStart = useFormFields(([fields]) => fields['timestampStart']?.value as number | undefined)
  const timestampEnd = useFormFields(([fields]) => fields['timestampEnd']?.value as number | undefined)

  const [externalUrl, setExternalUrl] = useState<string | null>(null)

  // Resolve the video's externalUrl — either from a populated object or by fetching via REST API
  useEffect(() => {
    if (!videoField) {
      setExternalUrl(null)
      return
    }

    if (typeof videoField === 'object' && videoField.externalUrl) {
      setExternalUrl(videoField.externalUrl)
      return
    }

    const videoId = typeof videoField === 'object' ? videoField.id : videoField
    if (!videoId) {
      setExternalUrl(null)
      return
    }

    fetch(`/api/videos/${videoId}?depth=0&select[externalUrl]=true`)
      .then((res) => res.json())
      .then((data) => setExternalUrl(data.externalUrl ?? null))
      .catch(() => setExternalUrl(null))
  }, [videoField])

  if (!externalUrl) {
    return null
  }

  const youtubeId = extractYouTubeId(externalUrl)
  if (!youtubeId) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-500)', fontSize: '14px' }}>
        Embedded player only supports YouTube URLs.
      </div>
    )
  }

  const params = new URLSearchParams()
  if (timestampStart != null) params.set('start', String(Math.floor(timestampStart)))
  if (timestampEnd != null) params.set('end', String(Math.ceil(timestampEnd)))
  const paramString = params.toString()

  return (
    <div style={{ padding: '12px 0' }}>
      <iframe
        width="100%"
        height="315"
        src={`https://www.youtube.com/embed/${youtubeId}${paramString ? `?${paramString}` : ''}`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ borderRadius: 'var(--style-radius-s)', border: '1px solid var(--theme-elevation-300)' }}
      />
    </div>
  )
}
