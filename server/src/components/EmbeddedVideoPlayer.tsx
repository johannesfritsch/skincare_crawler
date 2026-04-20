'use client'

import { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

export default function EmbeddedVideoPlayer() {
  const { id } = useDocumentInfo()
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [externalUrl, setExternalUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/videos/${id}?depth=1&select[videoFile]=true&select[audioFile]=true&select[externalUrl]=true`)
      .then((res) => res.json())
      .then((doc) => {
        const vf = doc.videoFile
        if (vf && typeof vf !== 'number') setVideoUrl(vf.url ?? null)
        const af = doc.audioFile
        if (af && typeof af !== 'number') setAudioUrl(af.url ?? null)
        setExternalUrl(doc.externalUrl ?? null)
      })
      .catch(() => {})
  }, [id])

  if (!videoUrl && !audioUrl) return null

  return (
    <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {videoUrl && (
        <video
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          style={{
            width: '100%',
            maxHeight: '480px',
            borderRadius: 'var(--style-radius-s)',
            background: '#000',
          }}
        />
      )}
      {audioUrl && (
        <div>
          <span style={{ fontSize: '12px', color: 'var(--theme-elevation-500)', fontWeight: 500 }}>
            Audio
          </span>
          <audio
            src={audioUrl}
            controls
            preload="metadata"
            style={{ width: '100%', marginTop: '4px' }}
          />
        </div>
      )}
      {externalUrl && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '12px',
            color: 'var(--theme-elevation-500)',
          }}
        >
          Open original &rarr;
        </a>
      )}
    </div>
  )
}
