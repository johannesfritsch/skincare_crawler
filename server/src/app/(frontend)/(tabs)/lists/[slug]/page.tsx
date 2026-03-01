import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { ScoreBadge, starsToScore10 } from '@/lib/score-utils'

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

  // Correlated subquery: avg creator sentiment per product (0–10 scale)
  const creatorScoreSub = sql<number | null>`(
    SELECT round(((avg(vm.overall_sentiment_score) + 1) * 5)::numeric, 1)
    FROM video_mentions vm
    WHERE vm.product_id = ${t.products}.id
      AND vm.overall_sentiment_score IS NOT NULL
  )`

  // Get top-rated products for this type
  const products = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: sql<string | null>`min(${t.product_variants.gtin})`,
      brandName: t.brands.name,
      avgRating: sql<number>`round(avg(${t.source_products.rating})::numeric, 1)`,
      totalReviews: sql<number>`sum(${t.source_products.ratingNum})::int`,
      creatorScore: creatorScoreSub,
      imageUrl: sql<string | null>`coalesce(${t.media}.sizes_thumbnail_url, ${t.media}.url)`,
    })
    .from(t.products)
    .innerJoin(t.product_variants, eq(t.product_variants.product, t.products.id))
    .innerJoin(t.source_variants, eq(t.source_variants.gtin, t.product_variants.gtin))
    .innerJoin(t.source_products, eq(t.source_variants.sourceProduct, t.source_products.id))
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.media, eq(t.products.image, t.media.id))
    .where(sql`${t.products.productType} = ${productType.id}`)
    .groupBy(t.products.id, t.products.name, t.brands.name, sql`${t.media}.sizes_thumbnail_url`, t.media.url)
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
        {products.map((p, i) => {
          const storeScore = p.avgRating != null && Number(p.avgRating) > 0 ? starsToScore10(Number(p.avgRating)) : null
          return (
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

              {/* Thumbnail */}
              <div className="h-10 w-10 shrink-0 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden p-1">
                {p.imageUrl ? (
                  <Image
                    src={p.imageUrl}
                    alt={p.name ?? 'Product'}
                    width={96}
                    height={96}
                    className="h-full w-full object-contain"
                    sizes="40px"
                  />
                ) : (
                  <span className="text-sm font-semibold text-muted-foreground/30">
                    {(p.name ?? '?')[0]?.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Product info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground truncate">{p.brandName ?? 'No brand'}</p>
              </div>

              {/* Scores */}
              <div className="flex items-center gap-1.5 shrink-0">
                {storeScore != null && <ScoreBadge score={storeScore} />}
                {p.creatorScore != null && <ScoreBadge score={Number(p.creatorScore)} />}
              </div>
            </Link>
          )
        })}
      </div>

      {products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No rated products in this category yet.</p>
        </div>
      )}
    </div>
  )
}
