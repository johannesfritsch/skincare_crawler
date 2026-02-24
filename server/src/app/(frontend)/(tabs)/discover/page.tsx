import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { ProductCard } from '@/components/product-card'

export const metadata = {
  title: 'Discover — AnySkin',
}

export default async function DiscoverPage() {
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  // Top-rated products: join products → source_products via GTIN,
  // aggregate avg rating weighted by review count, grouped per product
  const topProducts = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      brandName: t.brands.name,
      productTypeName: t.product_types.name,
      avgRating: sql<number>`round(avg(${t.source_products.rating})::numeric, 1)`,
      totalReviews: sql<number>`sum(${t.source_products.ratingNum})::int`,
    })
    .from(t.products)
    .innerJoin(t.source_products, eq(t.source_products.gtin, t.products.gtin))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .where(gt(t.source_products.rating, 0))
    .groupBy(
      t.products.id,
      t.products.name,
      t.products.gtin,
      t.brands.name,
      t.product_types.name,
    )
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
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      brandName: t.brands.name,
      productTypeName: t.product_types.name,
      avgRating: sql<number>`round(avg(${t.source_products.rating})::numeric, 1)`,
      totalReviews: sql<number>`sum(${t.source_products.ratingNum})::int`,
    })
    .from(t.products)
    .leftJoin(t.source_products, eq(t.source_products.gtin, t.products.gtin))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .where(isNotNull(t.products.name))
    .groupBy(
      t.products.id,
      t.products.name,
      t.products.gtin,
      t.brands.name,
      t.product_types.name,
    )
    .orderBy(desc(t.products.createdAt))
    .limit(12)

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Discover</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Top-rated cosmetics from German retailers</p>
      </div>

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
                <ProductCard key={p.id} {...p} />
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
                <ProductCard key={p.id} {...p} />
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
