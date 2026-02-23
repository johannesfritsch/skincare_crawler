import { getPayload } from 'payload'
import config from '@payload-config'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import React from 'react'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const productId = Number(id)
  if (Number.isNaN(productId)) notFound()

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  // Main product with brand, category, product type
  const [product] = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      description: t.products.description,
      brandName: t.brands.name,
      categoryName: t.categories.name,
      productTypeName: t.product_types.name,
      publishedAt: t.products.publishedAt,
      lastAggregatedAt: t.products.lastAggregatedAt,
      createdAt: t.products.createdAt,
      updatedAt: t.products.updatedAt,
    })
    .from(t.products)
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.categories, eq(t.products.category, t.categories.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .where(eq(t.products.id, productId))
    .limit(1)

  if (!product) notFound()

  // Ingredients
  const ingredients = await db
    .select({
      name: t.products_ingredients.name,
    })
    .from(t.products_ingredients)
    .where(eq(t.products_ingredients._parentID, productId))

  // Claims
  const claims = await db
    .select({
      claim: t.products_product_claims.claim,
      evidenceType: t.products_product_claims.evidenceType,
      snippet: t.products_product_claims.snippet,
    })
    .from(t.products_product_claims)
    .where(eq(t.products_product_claims._parentID, productId))

  // Attributes
  const attributes = await db
    .select({
      attribute: t.products_product_attributes.attribute,
      evidenceType: t.products_product_attributes.evidenceType,
      snippet: t.products_product_attributes.snippet,
    })
    .from(t.products_product_attributes)
    .where(eq(t.products_product_attributes._parentID, productId))

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <p><a href="/products" style={{ color: '#0070f3', textDecoration: 'none' }}>&larr; All products</a></p>

      <h1>{product.name || 'Unnamed product'}</h1>

      <table style={{ borderCollapse: 'collapse', marginBottom: '2rem' }}>
        <tbody>
          {[
            ['GTIN', product.gtin],
            ['Brand', product.brandName],
            ['Category', product.categoryName],
            ['Product Type', product.productTypeName],
            ['Published', formatDate(product.publishedAt)],
            ['Last Aggregated', formatDate(product.lastAggregatedAt)],
            ['Created', formatDate(product.createdAt)],
          ].map(([label, value]) => (
            <tr key={label as string} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.4rem 1rem 0.4rem 0', color: '#666', whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '0.4rem 0' }}>{(value as string) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {product.description && (
        <>
          <h2>Description</h2>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{product.description}</p>
        </>
      )}

      <h2>Ingredients ({ingredients.length})</h2>
      {ingredients.length > 0 ? (
        <p style={{ lineHeight: 1.8 }}>
          {ingredients.map((ing, i) => (
            <span key={i}>
              {ing.name}{i < ingredients.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      ) : (
        <p style={{ color: '#999' }}>No ingredients listed</p>
      )}

      <h2>Claims ({claims.length})</h2>
      {claims.length > 0 ? (
        <ul>
          {claims.map((c, i) => (
            <li key={i}>
              <strong>{c.claim}</strong>
              <span style={{ color: '#666' }}> — {c.evidenceType}{c.snippet ? `: "${c.snippet}"` : ''}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: '#999' }}>No claims</p>
      )}

      <h2>Attributes ({attributes.length})</h2>
      {attributes.length > 0 ? (
        <ul>
          {attributes.map((a, i) => (
            <li key={i}>
              <strong>{a.attribute}</strong>
              <span style={{ color: '#666' }}> — {a.evidenceType}{a.snippet ? `: "${a.snippet}"` : ''}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: '#999' }}>No attributes</p>
      )}
    </div>
  )
}
