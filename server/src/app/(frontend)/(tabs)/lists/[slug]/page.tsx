import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, gt, sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export default async function TopListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!slug) notFound()

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  // Get the product type
  const [productType] = await db
    .select({ id: t.product_types.id, name: t.product_types.name })
    .from(t.product_types)
    .where(eq(t.product_types.slug, slug))
    .limit(1)

  if (!productType) notFound()

  // Get top-rated products for this type
  const products = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      brandName: t.brands.name,
      avgRating: sql<number>`round(avg(${t.source_products.rating})::numeric, 1)`,
      totalReviews: sql<number>`sum(${t.source_products.ratingNum})::int`,
    })
    .from(t.products)
    .innerJoin(t.source_products, eq(t.source_products.gtin, t.products.gtin))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .where(eq(t.products.productType, productType.id))
    .groupBy(t.products.id, t.products.name, t.products.gtin, t.brands.name)
    .orderBy(desc(sql`avg(${t.source_products.rating})`))
    .limit(50)

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Top {productType.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {products.length} product{products.length !== 1 ? 's' : ''} ranked by rating
        </p>
      </div>

      {/* Ranked product list */}
      <div className="flex flex-col gap-1.5">
        {products.map((p, i) => (
          <Link
            key={p.id}
            href={`/products/${p.gtin}`}
            className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors active:bg-muted/60"
          >
            {/* Rank */}
            <span className={`text-sm font-bold w-6 text-center shrink-0 ${
              i < 3 ? 'text-primary' : 'text-muted-foreground'
            }`}>
              {i + 1}
            </span>

            {/* Product info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{p.name}</p>
              <p className="text-xs text-muted-foreground truncate">{p.brandName ?? 'No brand'}</p>
            </div>

            {/* Rating */}
            <div className="flex items-center gap-1 shrink-0">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="text-sm font-semibold">{p.avgRating}</span>
              {p.totalReviews != null && p.totalReviews > 0 && (
                <span className="text-[11px] text-muted-foreground ml-0.5">
                  ({p.totalReviews.toLocaleString('de-DE')})
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No rated products in this category yet.</p>
        </div>
      )}
    </div>
  )
}
