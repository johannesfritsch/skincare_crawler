import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, sql } from 'drizzle-orm'
import React from 'react'

export const metadata = {
  title: 'Products',
}

export default async function ProductsPage() {
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const { products, brands, product_types } = payload.db.tables

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      gtin: products.gtin,
      description: products.description,
      brandName: brands.name,
      productTypeName: product_types.name,
      createdAt: products.createdAt,
    })
    .from(products)
    .leftJoin(brands, eq(products.brand, brands.id))
    .leftJoin(product_types, eq(products.productType, product_types.id))
    .orderBy(desc(products.createdAt))
    .limit(50)

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
  const totalCount = countResult[0]?.count ?? 0

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>Products ({totalCount})</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Showing {rows.length} of {totalCount} products (queried via Drizzle)
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
            <th style={{ padding: '0.75rem 0.5rem' }}>Name</th>
            <th style={{ padding: '0.75rem 0.5rem' }}>GTIN</th>
            <th style={{ padding: '0.75rem 0.5rem' }}>Brand</th>
            <th style={{ padding: '0.75rem 0.5rem' }}>Type</th>
            <th style={{ padding: '0.75rem 0.5rem' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.5rem' }}>
                <a href={`/products/${row.id}`} style={{ color: '#0070f3', textDecoration: 'none' }}>
                  {row.name || '—'}
                </a>
              </td>
              <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.9em' }}>
                {row.gtin || '—'}
              </td>
              <td style={{ padding: '0.5rem' }}>{row.brandName || '—'}</td>
              <td style={{ padding: '0.5rem' }}>{row.productTypeName || '—'}</td>
              <td style={{ padding: '0.5rem', color: '#666', fontSize: '0.9em' }}>
                {row.createdAt ? new Date(row.createdAt).toLocaleDateString('de-DE') : '—'}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>
                No products found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
