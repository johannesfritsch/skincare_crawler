import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, gt, sql } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, Star, Trophy } from 'lucide-react'

export const metadata = {
  title: 'Top Lists — AnySkin',
}

export default async function ListsPage() {
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  // Get all product types with their product count and average rating
  const productTypes = await db
    .select({
      id: t.product_types.id,
      name: t.product_types.name,
      slug: t.product_types.slug,
      productCount: sql<number>`count(DISTINCT ${t.products.id})::int`,
      avgRating: sql<number>`round(avg(${t.source_products.rating})::numeric, 1)`,
    })
    .from(t.product_types)
    .innerJoin(t.products, eq(t.products.productType, t.product_types.id))
    .innerJoin(t.source_variants, eq(t.source_variants.gtin, t.products.gtin))
    .innerJoin(t.source_products, eq(t.source_variants.sourceProduct, t.source_products.id))
    .where(gt(t.source_products.rating, 0))
    .groupBy(t.product_types.id, t.product_types.name, t.product_types.slug)
    .orderBy(desc(sql`count(DISTINCT ${t.products.id})`))

  return (
    <div className="space-y-6">
      {/* Product type list */}
      <div className="flex flex-col gap-1.5">
        {productTypes.map((pt) => (
          <Link
            key={pt.id}
            href={`/lists/${pt.slug}`}
            className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 transition-colors active:bg-muted/60"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 shrink-0">
              <Trophy className="h-5 w-5 text-muted-foreground/60" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{pt.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {pt.productCount} product{pt.productCount !== 1 ? 's' : ''}
                </span>
                {pt.avgRating != null && pt.avgRating > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {pt.avgRating} avg
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          </Link>
        ))}
      </div>

      {productTypes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No categories yet.</p>
        </div>
      )}
    </div>
  )
}
