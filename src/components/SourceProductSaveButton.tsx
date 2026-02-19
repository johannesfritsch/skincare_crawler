'use client'

import React, { useState } from 'react'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { crawlSourceProduct } from '@/actions/crawl-source-product'

export default function SourceProductSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const handleCrawl = async () => {
    if (!id) return
    setLoading(true)
    setMessage(null)

    try {
      const result = await crawlSourceProduct(Number(id))
      if (result.success) {
        setMessage({ text: `Crawl #${result.crawlId} created`, isError: false })
      } else {
        setMessage({ text: result.error || 'Failed to create crawl', isError: true })
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Unknown error', isError: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <button
          onClick={handleCrawl}
          disabled={loading}
          type="button"
          style={{
            padding: '8px 16px',
            background: loading ? 'var(--theme-elevation-200)' : 'var(--theme-elevation-150)',
            border: '1px solid var(--theme-elevation-300)',
            borderRadius: 'var(--style-radius-s)',
            cursor: loading ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Crawling...' : 'Crawl'}
        </button>
      )}
      {message && (
        <span style={{
          color: message.isError ? 'var(--theme-error-500)' : 'var(--theme-success-500)',
          fontSize: '14px',
          whiteSpace: 'nowrap',
        }}>
          {message.text}
        </span>
      )}
    </div>
  )
}
