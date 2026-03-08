'use client'

import React from 'react'
import type { DefaultCellComponentProps } from 'payload'
import { ExternalLink } from 'lucide-react'
import { StoreLogo } from './store-logos'
import { STORE_LABELS, detectStoreFromUrl } from '@/collections/shared/store-fields'

/**
 * Custom cell for list views. Works on two field types:
 *
 * 1. On `source` (select field, source-products): cellData is the slug ("dm"),
 *    sourceUrl comes from rowData.sourceUrl.
 *
 * 2. On `sourceUrl` (text field, source-variants): cellData is the URL,
 *    store slug is detected from the hostname.
 *
 * Renders: [StoreLogo] Store Name [↗]  — clickable link to the store product page.
 */
export default function SourceUrlCell({ cellData, rowData }: DefaultCellComponentProps) {
  let slug: string | null = null
  let url: string | null = null

  const value = typeof cellData === 'string' ? cellData : null

  if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
    // Cell is on sourceUrl field — value is the URL
    url = value
    slug = detectStoreFromUrl(value)
  } else if (value) {
    // Cell is on source field — value is the slug
    slug = value
    url = typeof rowData?.sourceUrl === 'string' ? rowData.sourceUrl : null
  }

  const label = (slug && STORE_LABELS[slug]) || slug || value || ''

  const content = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
      {slug && (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '16px', flexShrink: 0 }}>
          <StoreLogo source={slug} />
        </span>
      )}
      <span>{label}</span>
    </span>
  )

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: 'inherit',
          textDecoration: 'none',
        }}
        title={url}
      >
        {content}
        <ExternalLink size={12} style={{ opacity: 0.4, flexShrink: 0 }} />
      </a>
    )
  }

  return content
}
