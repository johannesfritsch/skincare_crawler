'use client'

import React from 'react'
import type { DefaultCellComponentProps } from 'payload'

/**
 * Custom list cell for the product name that links to the edit page.
 * Needed because the default link behavior is lost when a ui field (productImage)
 * is the first column.
 */
export default function ProductNameCell({ cellData, rowData }: DefaultCellComponentProps) {
  const name = typeof cellData === 'string' ? cellData : null
  const id = rowData?.id

  if (!name || !id) {
    return <span style={{ color: 'var(--theme-elevation-400)' }}>—</span>
  }

  return (
    <a
      href={`/admin/collections/products/${id}`}
      style={{
        color: 'var(--theme-text)',
        textDecoration: 'none',
        fontWeight: 500,
      }}
    >
      {name}
    </a>
  )
}
