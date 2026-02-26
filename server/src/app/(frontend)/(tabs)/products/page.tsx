import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import React, { Suspense } from 'react'
import Link from 'next/link'
import { ProductSearch } from '@/components/product-search'
import { ProductCard } from '@/components/product-card'
import { starsToScore10 } from '@/lib/score-utils'

export const metadata = {
  title: 'Products — AnySkin',
}

interface Props {
  searchParams: Promise<{ q?: string }>
}

export default async function ProductsPage({ searchParams }: Props) {
  const { q } = await searchParams
  const searchTerm = q?.trim() || ''

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  // Correlated subquery: avg creator sentiment per product (0–10 scale)
  const creatorScoreSub = sql<number | null>`(
    SELECT round(((avg(vm.overall_sentiment_score) + 1) * 5)::numeric, 1)
    FROM video_mentions vm
    WHERE vm.product_id = ${t.products}.id
      AND vm.overall_sentiment_score IS NOT NULL
  )`

  // Build base query — join source_products for ratings
  let query = db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      brandName: t.brands.name,
      productTypeName: t.product_types.name,
      avgRating: sql<number | null>`round(avg(${t.source_products.rating})::numeric, 1)`,
      creatorScore: creatorScoreSub,
      imageUrl: sql<string | null>`coalesce(${t.media}.sizes_card_url, ${t.media}.url)`,
    })
    .from(t.products)
    .leftJoin(t.source_products, eq(t.source_products.gtin, t.products.gtin))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .leftJoin(t.media, eq(t.products.image, t.media.id))
    .groupBy(
      t.products.id,
      t.products.name,
      t.products.gtin,
      t.brands.name,
      t.product_types.name,
      sql`${t.media}.sizes_card_url`,
      t.media.url,
    )
    .orderBy(desc(t.products.createdAt))
    .limit(60)
    .$dynamic()

  // Build count query
  let countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(t.products)
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .$dynamic()

  if (searchTerm) {
    const pattern = `%${searchTerm}%`
    const whereClause = or(
      ilike(t.products.name, pattern),
      ilike(t.products.gtin, pattern),
      ilike(t.brands.name, pattern),
    )
    query = query.where(whereClause)
    countQuery = countQuery.where(whereClause)
  }

  const [rows, countResult] = await Promise.all([query, countQuery])
  const totalCount = Number(countResult[0]?.count ?? 0)

  return (
    <div>
      <div className="mb-5">
        <Suspense>
          <ProductSearch />
        </Suspense>
      </div>

      {/* Result count */}
      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {searchTerm
            ? `${rows.length} of ${totalCount} result${totalCount !== 1 ? 's' : ''} for "${searchTerm}"`
            : `${totalCount} product${totalCount !== 1 ? 's' : ''}`}
        </p>
      )}

      {/* Search empty state */}
      {searchTerm && rows.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-muted-foreground">
            No products found for &ldquo;{searchTerm}&rdquo;
          </p>
          <Link href="/products" className="text-sm text-primary hover:underline mt-2 inline-block">
            Clear search
          </Link>
        </div>
      )}

      {/* Product grid */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {rows.map((p) => (
            <ProductCard
              key={p.id}
              gtin={p.gtin}
              name={p.name}
              brandName={p.brandName}
              productTypeName={p.productTypeName}
              creatorScore={p.creatorScore}
              storeScore={p.avgRating != null && Number(p.avgRating) > 0 ? starsToScore10(Number(p.avgRating)) : null}
              imageUrl={p.imageUrl}
            />
          ))}
        </div>
      )}

      {/* Global empty state */}
      {!searchTerm && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No products yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Scan a barcode or search to get started.</p>
        </div>
      )}
    </div>
  )
}
