import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, sql } from 'drizzle-orm'
import { ProductCard } from '@/components/product-card'
import { starsToScore10 } from '@/lib/score-utils'

export const metadata = {
  title: 'Discover — AnySkin',
}

export default async function DiscoverPage() {
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

  // Shared select columns for both queries
  const columns = {
    id: t.products.id,
    name: t.products.name,
    gtin: t.product_variants.gtin,
    brandName: t.brands.name,
    productTypeName: t.product_types.name,
    avgRating: sql<number | null>`round(avg(${t.source_products.rating})::numeric, 1)`,
    creatorScore: creatorScoreSub,
    imageUrl: sql<string | null>`coalesce(${t.media}.sizes_card_url, ${t.media}.url)`,
  }

  // Shared groupBy columns
  const groupCols = [
    t.products.id,
    t.products.name,
    t.product_variants.gtin,
    t.brands.name,
    t.product_types.name,
    sql`${t.media}.sizes_card_url`,
    t.media.url,
  ] as const

  // Top-rated products: only those with store ratings
  const topProducts = await db
    .select(columns)
    .from(t.products)
    .innerJoin(t.product_variants, eq(t.product_variants.product, t.products.id))
    .innerJoin(t.source_variants, eq(t.source_variants.gtin, t.product_variants.gtin))
    .innerJoin(t.source_products, eq(t.source_variants.sourceProduct, t.source_products.id))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .leftJoin(t.media, eq(t.products.image, t.media.id))
    .where(sql`${t.source_products.rating} > 0 AND ${t.product_variants.isDefault} = true`)
    .groupBy(...groupCols)
    .orderBy(desc(sql`avg(${t.source_products.rating})`))
    .limit(100)

  // Group by product type
  const byType = new Map<string, { typeName: string; products: typeof topProducts }>()

  for (const p of topProducts) {
    const key = p.productTypeName ?? '_uncategorized'
    if (!byType.has(key)) {
      byType.set(key, { typeName: p.productTypeName ?? 'Other', products: [] })
    }
    byType.get(key)!.products.push(p)
  }

  // Recently added products — with ratings when available
  const recentProducts = await db
    .select(columns)
    .from(t.products)
    .innerJoin(t.product_variants, eq(t.product_variants.product, t.products.id))
    .leftJoin(t.source_variants, eq(t.source_variants.gtin, t.product_variants.gtin))
    .leftJoin(t.source_products, eq(t.source_variants.sourceProduct, t.source_products.id))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .leftJoin(t.media, eq(t.products.image, t.media.id))
    .where(sql`${t.products.name} IS NOT NULL AND ${t.product_variants.isDefault} = true`)
    .groupBy(...groupCols)
    .orderBy(desc(t.products.createdAt))
    .limit(12)

  /** Map a DB row to ProductCard props */
  function cardProps(p: typeof topProducts[number]) {
    return {
      gtin: p.gtin,
      name: p.name,
      brandName: p.brandName,
      productTypeName: p.productTypeName,
      creatorScore: p.creatorScore,
      storeScore: p.avgRating != null && Number(p.avgRating) > 0 ? starsToScore10(Number(p.avgRating)) : null,
      imageUrl: p.imageUrl,
      className: 'snap-start shrink-0 w-40',
    }
  }

  return (
    <div className="space-y-8">
      {/* Recently added */}
      {recentProducts.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recently Added</h2>
            <span className="text-xs text-muted-foreground">{recentProducts.length} products</span>
          </div>
          <div className="overflow-x-auto -mx-4 snap-x snap-mandatory scroll-pl-4 scrollbar-none">
            <div className="inline-flex gap-3 px-4 pb-1">
              {recentProducts.map((p) => (
                <ProductCard key={p.id} {...cardProps(p)} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Top rated by product type */}
      {Array.from(byType.entries()).map(([key, { typeName, products }]) => (
        <section key={key}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Top {typeName}
            </h2>
            <span className="text-xs text-muted-foreground">{products.length} products</span>
          </div>
          <div className="overflow-x-auto -mx-4 snap-x snap-mandatory scroll-pl-4 scrollbar-none">
            <div className="inline-flex gap-3 px-4 pb-1">
              {products.slice(0, 10).map((p) => (
                <ProductCard key={p.id} {...cardProps(p)} />
              ))}
            </div>
          </div>
        </section>
      ))}

      {topProducts.length === 0 && recentProducts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No products yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Scan a barcode or search to get started.</p>
        </div>
      )}
    </div>
  )
}
