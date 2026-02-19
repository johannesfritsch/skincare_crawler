'use client'

import { useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
import { downloadCrawledGtins } from '@/actions/download-crawled-gtins'

export default function DownloadCrawledGtinsButton() {
  const { id } = useDocumentInfo()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!id) return null

  const handleDownload = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await downloadCrawledGtins(Number(id))
      if (!result.success || !result.data) {
        setError(result.error || 'No GTINs found')
        return
      }

      const blob = new Blob([result.data], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `crawl-${id}-gtins.txt`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <button
        onClick={handleDownload}
        disabled={loading}
        style={{
          padding: '8px 16px',
          background: loading ? 'var(--theme-elevation-200)' : 'var(--theme-elevation-150)',
          border: '1px solid var(--theme-elevation-300)',
          borderRadius: 'var(--style-radius-s)',
          cursor: loading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {loading ? 'Downloading...' : 'Download GTINs'}
      </button>
      {error && (
        <div style={{ color: 'var(--theme-error-500)', marginTop: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
