import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

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
      productTypeId: t.product_types.id,
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
      t.product_types.id,
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

  // Also get recently added products (separate query, no rating needed)
  const recentProducts = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      brandName: t.brands.name,
      productTypeName: t.product_types.name,
    })
    .from(t.products)
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .where(isNotNull(t.products.name))
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
          <div className="overflow-x-auto -mx-4 scrollbar-none">
            <div className="inline-flex gap-3 px-4 pb-1">
              {recentProducts.map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.gtin}`}
                  className="shrink-0 w-40 rounded-xl border bg-card p-3 transition-colors active:bg-muted/60"
                >
                  <div className="aspect-[4/3] rounded-lg bg-muted/50 flex items-center justify-center mb-2.5">
                    <span className="text-2xl font-semibold text-muted-foreground/30">
                      {(p.name ?? '?')[0]?.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.brandName ?? 'No brand'}</p>
                  {p.productTypeName && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1.5 truncate">{p.productTypeName}</p>
                  )}
                </Link>
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
          <div className="overflow-x-auto -mx-4 scrollbar-none">
            <div className="inline-flex gap-3 px-4 pb-1">
              {products.slice(0, 10).map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.gtin}`}
                  className="shrink-0 w-40 rounded-xl border bg-card p-3 transition-colors active:bg-muted/60"
                >
                  <div className="aspect-[4/3] rounded-lg bg-muted/50 flex items-center justify-center mb-2.5">
                    <span className="text-2xl font-semibold text-muted-foreground/30">
                      {(p.name ?? '?')[0]?.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.brandName ?? 'No brand'}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div className="flex items-center gap-0.5">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="text-xs font-semibold">{p.avgRating}</span>
                    </div>
                    {p.totalReviews != null && p.totalReviews > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        ({p.totalReviews.toLocaleString('de-DE')})
                      </span>
                    )}
                  </div>
                </Link>
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
