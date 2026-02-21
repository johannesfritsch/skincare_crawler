'use client'

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

export default function EmbeddedVideoPlayer() {
  const externalUrl = useFormFields(([fields]) => fields['externalUrl']?.value as string | undefined)

  if (!externalUrl) {
    return null
  }

  const videoId = extractYouTubeId(externalUrl)
  if (!videoId) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--theme-elevation-500)', fontSize: '14px' }}>
        Embedded player only supports YouTube URLs.
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <iframe
        width="100%"
        height="315"
        src={`https://www.youtube.com/embed/${videoId}`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ borderRadius: 'var(--style-radius-s)', border: '1px solid var(--theme-elevation-300)' }}
      />
    </div>
  )
}
