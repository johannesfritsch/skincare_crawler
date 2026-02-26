import { getPayload } from 'payload'
import config from '@payload-config'
import { eq, sql, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import {
  TrendingUp,
  TrendingDown,
  Video,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StoreLogo } from '@/components/store-logos'
import { Sparkline } from '@/components/sparkline'
import { ProductVideoList, type ProductVideoItem, type ProductVideoQuote } from '@/components/product-video-list'
import { TraitChipGroup, type TraitItem } from '@/components/trait-chip'
import { ATTRIBUTE_META, CLAIM_META } from '@/lib/product-traits'
import { AccordionSection } from '@/components/accordion-section'
import { CreatorScoreCard, StoreScoreCard, type CreatorScoreItem, type StoreScoreItem } from '@/components/score-sheet'
import { ScoreBadge, starsToScore10, storeLabel } from '@/lib/score-utils'
import { DescriptionTeaser } from '@/components/description-teaser'
import { IngredientChipGroup, type IngredientItem } from '@/components/ingredient-chip-group'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(cents: number | null): string {
  if (cents == null) return '—'
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`
}



/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function ProductDetailPage({ params }: { params: Promise<{ gtin: string }> }) {
  const { gtin } = await params
  if (!gtin) notFound()

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  /* ── Product basics ── */
  const [product] = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      description: t.products.description,
      brandName: t.brands.name,
      productTypeName: t.product_types.name,
      publishedAt: t.products.publishedAt,
      lastAggregatedAt: t.products.lastAggregatedAt,
      createdAt: t.products.createdAt,
      updatedAt: t.products.updatedAt,
      imageUrl: sql<string | null>`coalesce(${t.media}.sizes_detail_url, ${t.media}.url)`,
      imageAlt: t.media.alt,
      imageWidth: sql<number | null>`coalesce(${t.media}.sizes_detail_width, ${t.media}.width)::int`,
      imageHeight: sql<number | null>`coalesce(${t.media}.sizes_detail_height, ${t.media}.height)::int`,
    })
    .from(t.products)
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .leftJoin(t.media, eq(t.products.image, t.media.id))
    .where(eq(t.products.gtin, gtin))
    .limit(1)

  if (!product) notFound()
  const productId = product.id as number

  /* ── Run parallel queries ── */
  const [ingredients, claims, attributes, sourceProducts, videoMentions, creatorStats] = await Promise.all([
    /* Ingredients (join reference table for metadata) */
    db.select({
      name: t.products_ingredients.name,
      ingredientId: t.products_ingredients.ingredient,
      description: t.ingredients.description,
      casNumber: t.ingredients.casNumber,
      restrictions: t.ingredients.restrictions,
      functions: sql<string | null>`(
        SELECT string_agg(f.function, ', ' ORDER BY f._order)
        FROM ingredients_functions f
        WHERE f._parent_id = ${t.ingredients}.id
      )`,
    }).from(t.products_ingredients)
      .leftJoin(t.ingredients, eq(t.products_ingredients.ingredient, t.ingredients.id))
      .where(eq(t.products_ingredients._parentID, productId)),

    /* Claims */
    db.select({
      id: t.products_product_claims.id,
      claim: t.products_product_claims.claim,
      evidenceType: t.products_product_claims.evidenceType,
      snippet: t.products_product_claims.snippet,
      start: t.products_product_claims.start,
      end: t.products_product_claims.end,
      sourceProductId: t.products_product_claims.sourceProduct,
      sourceName: t.source_products.source,
    }).from(t.products_product_claims)
      .leftJoin(t.source_products, eq(t.products_product_claims.sourceProduct, t.source_products.id))
      .where(eq(t.products_product_claims._parentID, productId)),

    /* Attributes */
    db.select({
      id: t.products_product_attributes.id,
      attribute: t.products_product_attributes.attribute,
      evidenceType: t.products_product_attributes.evidenceType,
      snippet: t.products_product_attributes.snippet,
      start: t.products_product_attributes.start,
      end: t.products_product_attributes.end,
      sourceProductId: t.products_product_attributes.sourceProduct,
      sourceName: t.source_products.source,
    }).from(t.products_product_attributes)
      .leftJoin(t.source_products, eq(t.products_product_attributes.sourceProduct, t.source_products.id))
      .where(eq(t.products_product_attributes._parentID, productId)),

    /* Source products */
    db.select({
      id: t.source_products.id,
      source: t.source_products.source,
      name: t.source_products.name,
      sourceUrl: t.source_products.sourceUrl,
      rating: t.source_products.rating,
      ratingNum: t.source_products.ratingNum,
    }).from(t.source_products)
      .where(eq(t.source_products.gtin, gtin)),

    /* Video mentions for this product */
    db.select({
      mentionId: t.video_mentions.id,
      overallSentiment: t.video_mentions.overallSentiment,
      overallSentimentScore: t.video_mentions.overallSentimentScore,
      snippetId: t.video_snippets.id,
      timestampStart: t.video_snippets.timestampStart,
      videoId: t.videos.id,
      videoTitle: t.videos.title,
      videoDuration: t.videos.duration,
      videoThumbnailUrl: sql<string | null>`(
        SELECT coalesce(m.sizes_thumbnail_url, m.url)
        FROM media m WHERE m.id = ${t.videos}.image_id LIMIT 1
      )`,
      channelId: t.channels.id,
      channelPlatform: t.channels.platform,
      channelImageUrl: sql<string | null>`(
        SELECT coalesce(m.sizes_thumbnail_url, m.url)
        FROM media m WHERE m.id = ${t.channels}.image_id LIMIT 1
      )`,
      creatorName: t.creators.name,
    }).from(t.video_mentions)
      .innerJoin(t.video_snippets, eq(t.video_mentions.videoSnippet, t.video_snippets.id))
      .innerJoin(t.videos, eq(t.video_snippets.video, t.videos.id))
      .leftJoin(t.channels, eq(t.videos.channel, t.channels.id))
      .leftJoin(t.creators, eq(t.channels.creator, t.creators.id))
      .where(eq(t.video_mentions.product, productId))
      .orderBy(desc(t.videos.publishedAt)),

    /* Per-channel sentiment stats for this product (grouped by creator later) */
    db.select({
      creatorId: t.creators.id,
      creatorName: t.creators.name,
      channelId: t.channels.id,
      channelPlatform: t.channels.platform,
      channelExternalUrl: t.channels.externalUrl,
      channelImageUrl: sql<string | null>`(
        SELECT coalesce(m.sizes_thumbnail_url, m.url)
        FROM media m WHERE m.id = ${t.channels}.image_id LIMIT 1
      )`,
      mentionCount: sql<number>`count(${t.video_mentions.id})::int`,
      avgSentimentScore: sql<number | null>`round(avg(${t.video_mentions.overallSentimentScore})::numeric, 2)`,
      positiveCount: sql<number>`count(*) filter (where ${t.video_mentions.overallSentiment} = 'positive')::int`,
      negativeCount: sql<number>`count(*) filter (where ${t.video_mentions.overallSentiment} = 'negative')::int`,
      neutralCount: sql<number>`count(*) filter (where ${t.video_mentions.overallSentiment} = 'neutral')::int`,
      mixedCount: sql<number>`count(*) filter (where ${t.video_mentions.overallSentiment} = 'mixed')::int`,
    }).from(t.video_mentions)
      .innerJoin(t.video_snippets, eq(t.video_mentions.videoSnippet, t.video_snippets.id))
      .innerJoin(t.videos, eq(t.video_snippets.video, t.videos.id))
      .leftJoin(t.channels, eq(t.videos.channel, t.channels.id))
      .leftJoin(t.creators, eq(t.channels.creator, t.creators.id))
      .where(eq(t.video_mentions.product, productId))
      .groupBy(t.creators.id, t.creators.name, t.channels.id, t.channels.platform, t.channels.externalUrl),
  ])

  /* ── Ingredient names for attributes & claims evidence ── */
  const attrIds = attributes.map(a => a.id as number).filter(Boolean)
  const claimIds = claims.map(c => c.id as number).filter(Boolean)
  const mentionIds = videoMentions.map(m => m.mentionId as number).filter(Boolean)

  const [attrIngredientRows, claimIngredientRows, quoteRows] = await Promise.all([
    attrIds.length > 0
      ? db.select({
          parentId: t.products_product_attributes_ingredient_names._parentID,
          name: t.products_product_attributes_ingredient_names.name,
        }).from(t.products_product_attributes_ingredient_names)
          .where(sql`${t.products_product_attributes_ingredient_names._parentID} IN (${sql.join(attrIds.map(id => sql`${id}`), sql`, `)})`)
      : Promise.resolve([]),
    claimIds.length > 0
      ? db.select({
          parentId: t.products_product_claims_ingredient_names._parentID,
          name: t.products_product_claims_ingredient_names.name,
        }).from(t.products_product_claims_ingredient_names)
          .where(sql`${t.products_product_claims_ingredient_names._parentID} IN (${sql.join(claimIds.map(id => sql`${id}`), sql`, `)})`)
      : Promise.resolve([]),
    mentionIds.length > 0
      ? db.select({
          mentionId: t.video_mentions_quotes._parentID,
          text: t.video_mentions_quotes.text,
          sentiment: t.video_mentions_quotes.sentiment,
          sentimentScore: t.video_mentions_quotes.sentimentScore,
        }).from(t.video_mentions_quotes)
          .where(sql`${t.video_mentions_quotes._parentID} IN (${sql.join(mentionIds.map(id => sql`${id}`), sql`, `)})`)
          .orderBy(sql`abs(${t.video_mentions_quotes.sentimentScore}) DESC NULLS LAST`)
      : Promise.resolve([] as { mentionId: unknown; text: unknown; sentiment: unknown; sentimentScore: unknown }[]),
  ])

  // Group ingredient names by parent attribute/claim ID
  const attrIngredientMap = new Map<number, string[]>()
  for (const row of attrIngredientRows) {
    const pid = row.parentId as number
    if (!attrIngredientMap.has(pid)) attrIngredientMap.set(pid, [])
    if (row.name) attrIngredientMap.get(pid)!.push(row.name as string)
  }
  const claimIngredientMap = new Map<number, string[]>()
  for (const row of claimIngredientRows) {
    const pid = row.parentId as number
    if (!claimIngredientMap.has(pid)) claimIngredientMap.set(pid, [])
    if (row.name) claimIngredientMap.get(pid)!.push(row.name as string)
  }

  // Group quotes by mention ID
  const quotesByMention = new Map<number, ProductVideoQuote[]>()
  for (const row of quoteRows) {
    const mid = row.mentionId as number
    if (!quotesByMention.has(mid)) quotesByMention.set(mid, [])
    quotesByMention.get(mid)!.push({
      text: row.text as string,
      sentiment: row.sentiment as string | null,
      sentimentScore: row.sentimentScore as number | null,
    })
  }

  /* ── Price history per source ── */
  const priceHistoryRows = sourceProducts.length > 0
    ? await db.select({
        parentId: t.source_products_price_history._parentID,
        recordedAt: t.source_products_price_history.recordedAt,
        amount: t.source_products_price_history.amount,
        currency: t.source_products_price_history.currency,
        perUnitAmount: t.source_products_price_history.perUnitAmount,
        perUnitQuantity: t.source_products_price_history.perUnitQuantity,
        unit: t.source_products_price_history.unit,
      }).from(t.source_products_price_history)
        .where(sql`${t.source_products_price_history._parentID} IN (${sql.join(sourceProducts.map(sp => sql`${sp.id}`), sql`, `)})`)
        .orderBy(desc(t.source_products_price_history.recordedAt))
    : []

  // Group price history by source product
  const pricesBySourceProduct = new Map<number, typeof priceHistoryRows>()
  for (const row of priceHistoryRows) {
    const pid = row.parentId as number
    if (!pricesBySourceProduct.has(pid)) pricesBySourceProduct.set(pid, [])
    pricesBySourceProduct.get(pid)!.push(row)
  }

  /* ── Aggregate store ratings ── */
  const ratedStores = (sourceProducts as Array<{
    id: number; source: string | null; sourceUrl: string | null; rating: number | null; ratingNum: number | null
  }>).filter(sp => sp.rating != null && sp.ratingNum != null && sp.ratingNum > 0)
  const totalStoreReviews = ratedStores.reduce((sum, sp) => sum + (sp.ratingNum ?? 0), 0)
  const avgStoreRating = totalStoreReviews > 0
    ? ratedStores.reduce((sum, sp) => sum + (sp.rating as number) * (sp.ratingNum as number), 0) / totalStoreReviews
    : null // weighted average on 0–5 scale

  /* ── Aggregate sentiment ── */
  const totalMentions = videoMentions.length
  const avgSentiment = totalMentions > 0
    ? videoMentions.reduce((sum, m) => sum + ((m.overallSentimentScore as number | null) ?? 0), 0) / totalMentions
    : null
  /* ── Build video list for pagination ── */
  const videoItems: ProductVideoItem[] = videoMentions.map(m => ({
    videoId: m.videoId as number,
    videoTitle: m.videoTitle as string,
    videoThumbnailUrl: m.videoThumbnailUrl,
    videoDuration: m.videoDuration as number | null,
    creatorName: m.creatorName as string | null,
    channelImageUrl: m.channelImageUrl,
    channelPlatform: m.channelPlatform as string | null,
    overallSentiment: m.overallSentiment as string | null,
    overallSentimentScore: m.overallSentimentScore as number | null,
    timestampStart: m.timestampStart as number | null,
    snippetId: m.snippetId as number | null,
    quotes: quotesByMention.get(m.mentionId as number) ?? [],
  }))

  /* ── Prepare sparkline data: last 12 months, oldest→newest ── */
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  function getSparklineData(sourceProductId: number): number[] {
    const prices = pricesBySourceProduct.get(sourceProductId) ?? []
    // Filter to last 12 months, then reverse to chronological (oldest first)
    return prices
      .filter(p => p.recordedAt && new Date(p.recordedAt as string) >= oneYearAgo)
      .reverse()
      .map(p => p.amount as number)
  }

  /* ── Build trait items for the chip group ── */
  const traitItems: TraitItem[] = [
    ...attributes.flatMap((a, i) => {
      const meta = ATTRIBUTE_META[a.attribute as string]
      if (!meta) return []
      return [{
        id: `attr-${i}`,
        title: meta.title,
        description: meta.description,
        icon: meta.icon,
        tone: meta.tone,
        kind: 'attribute' as const,
        evidence: {
          sourceName: a.sourceName as string | null,
          evidenceType: a.evidenceType as string | null,
          snippet: a.snippet as string | null,
          start: a.start as number | null,
          end: a.end as number | null,
          ingredientNames: attrIngredientMap.get(a.id as number) ?? [],
        },
      }]
    }),
    ...claims.flatMap((c, i) => {
      const meta = CLAIM_META[c.claim as string]
      if (!meta) return []
      return [{
        id: `claim-${i}`,
        title: meta.title,
        description: meta.description,
        icon: meta.icon,
        tone: meta.tone,
        kind: 'claim' as const,
        evidence: {
          sourceName: c.sourceName as string | null,
          evidenceType: c.evidenceType as string | null,
          snippet: c.snippet as string | null,
          start: c.start as number | null,
          end: c.end as number | null,
          ingredientNames: claimIngredientMap.get(c.id as number) ?? [],
        },
      }]
    }),
  ]

  /* ── Build ingredient items for the chip group ── */
  const ingredientItems: IngredientItem[] = ingredients.map(ing => ({
    name: ing.name as string,
    description: (ing.description as string | null) ?? null,
    casNumber: (ing.casNumber as string | null) ?? null,
    restrictions: (ing.restrictions as string | null) ?? null,
    functions: (ing.functions as string | null) ?? null,
    hasData: !!(ing.description || ing.functions || ing.casNumber || ing.restrictions),
  }))

  /* ── Group channel-level rows into per-creator stats ── */
  type ChannelRow = {
    creatorId: number | null
    creatorName: string | null
    channelId: number | null
    channelPlatform: string | null
    channelExternalUrl: string | null
    channelImageUrl: string | null
    mentionCount: number
    avgSentimentScore: number | null
    positiveCount: number
    negativeCount: number
    neutralCount: number
    mixedCount: number
  }
  const channelRows = creatorStats as ChannelRow[]

  const creatorMap = new Map<number | string, CreatorScoreItem>()
  for (const row of channelRows) {
    const key = row.creatorId ?? `unknown-${row.channelId}`
    let creator = creatorMap.get(key)
    if (!creator) {
      creator = {
        creatorId: row.creatorId,
        creatorName: row.creatorName,
        channelImageUrl: row.channelImageUrl,
        mentionCount: 0,
        avgSentimentScore: null,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        mixedCount: 0,
        channels: [],
      }
      creatorMap.set(key, creator)
    }
    // Aggregate counts
    creator.mentionCount += row.mentionCount
    creator.positiveCount += row.positiveCount
    creator.negativeCount += row.negativeCount
    creator.neutralCount += row.neutralCount
    creator.mixedCount += row.mixedCount
    // Use first non-null image
    if (!creator.channelImageUrl && row.channelImageUrl) {
      creator.channelImageUrl = row.channelImageUrl
    }
    // Add channel
    if (row.channelId != null) {
      creator.channels.push({
        channelId: row.channelId,
        platform: row.channelPlatform,
        externalUrl: row.channelExternalUrl,
        imageUrl: row.channelImageUrl,
      })
    }
  }
  // Recompute weighted avg sentiment per creator
  for (const [key, creator] of creatorMap) {
    const rows = channelRows.filter(r => (r.creatorId ?? `unknown-${r.channelId}`) === key)
    const totalMentionsForCreator = rows.reduce((s, r) => s + r.mentionCount, 0)
    if (totalMentionsForCreator > 0) {
      const weightedSum = rows.reduce((s, r) => s + (Number(r.avgSentimentScore) || 0) * r.mentionCount, 0)
      creator.avgSentimentScore = Math.round((weightedSum / totalMentionsForCreator) * 100) / 100
    }
  }
  const typedCreatorStats = Array.from(creatorMap.values())

  /* ── Render ── */

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* ═══ Hero: image + name + sentiment badge ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
        {product.imageUrl && (
          <div className="shrink-0 self-center sm:self-start w-48 sm:w-56 aspect-square rounded-2xl bg-muted/50 overflow-hidden p-4">
            <Image
              src={product.imageUrl}
              alt={product.imageAlt || product.name || 'Product image'}
              width={product.imageWidth || 780}
              height={product.imageHeight || 780}
              className="h-full w-full object-contain"
              sizes="(min-width: 640px) 224px, 192px"
              priority
            />
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Name + brand */}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{product.name || 'Unnamed product'}</h1>
            {(product.brandName || product.productTypeName) && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {[product.brandName, product.productTypeName].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {/* Score cards row */}
          <div className="flex flex-wrap gap-2 mt-5">
            {/* Creator score (shows empty state when no mentions) */}
            <CreatorScoreCard
              avgSentiment={avgSentiment}
              totalMentions={totalMentions}
              creators={typedCreatorStats as CreatorScoreItem[]}
            />

            {/* Store score */}
            {avgStoreRating != null && (
              <StoreScoreCard
                avgStoreRating={avgStoreRating}
                stores={ratedStores as StoreScoreItem[]}
              />
            )}
          </div>

          {/* Attribute & claim chips */}
          {traitItems.length > 0 && (
            <div className="mt-5">
              <TraitChipGroup items={traitItems} />
            </div>
          )}

          {/* Description teaser */}
          {product.description && (
            <DescriptionTeaser description={product.description} />
          )}

        </div>
      </div>

      {/* ═══ Videos (merged: mentions with quotes + all videos) ═══ */}
      {videoItems.length > 0 && (
        <AccordionSection
          title={
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Videos</span>
            </div>
          }
          trailing={
            <span className="text-xs text-muted-foreground">
              {videoItems.length} mention{videoItems.length !== 1 ? 's' : ''}
            </span>
          }
          defaultOpen
        >
          <ProductVideoList videos={videoItems} />
        </AccordionSection>
      )}

      {/* ═══ Prices & Store Availability ═══ */}
      {sourceProducts.length > 0 && (
        <AccordionSection
          title="Prices & Stores"
          trailing={<span className="text-xs text-muted-foreground">{sourceProducts.length} store{sourceProducts.length !== 1 ? 's' : ''}</span>}
          defaultOpen
        >
          <div className="flex flex-col gap-2.5">
            {(sourceProducts as Array<{
              id: number
              source: string | null
              name: string | null
              sourceUrl: string | null
              rating: number | null
              ratingNum: number | null
            }>).map((sp) => {
              const prices = pricesBySourceProduct.get(sp.id) ?? []
              const latestPrice = prices[0]
              const previousPrice = prices.length > 1 ? prices[1] : null
              const priceChange = latestPrice && previousPrice
                ? (latestPrice.amount as number) - (previousPrice.amount as number)
                : null
              const sparklineData = getSparklineData(sp.id)
              const hasRating = sp.rating != null && sp.ratingNum != null && (sp.ratingNum as number) > 0
              const score10 = hasRating ? starsToScore10(Number(sp.rating)) : null
              const Row = sp.sourceUrl ? 'a' : 'div'
              const linkProps = sp.sourceUrl
                ? { href: sp.sourceUrl, target: '_blank' as const, rel: 'noopener noreferrer' }
                : {}

              return (
                <Row
                  key={sp.id}
                  {...linkProps}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3',
                    sp.sourceUrl && 'active:opacity-80 touch-manipulation transition-colors',
                  )}
                >
                  {/* Store logo */}
                  <div className="shrink-0 flex items-center justify-center rounded-lg bg-muted/40 border border-border/60 size-10 p-1.5">
                    <StoreLogo source={sp.source ?? ''} className="!h-5" />
                  </div>

                  {/* Store name + price info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{storeLabel(sp.source)}</p>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-sm font-semibold">
                        {formatPrice(latestPrice?.amount as number | null)}
                      </span>
                      {priceChange != null && priceChange !== 0 && (
                        <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium', priceChange < 0 ? 'text-emerald-600' : 'text-red-500')}>
                          {priceChange < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />}
                          {formatPrice(Math.abs(priceChange))}
                        </span>
                      )}
                    </div>
                    {latestPrice?.perUnitAmount != null && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatPrice(latestPrice.perUnitAmount as number)} / {latestPrice.perUnitQuantity ?? 1} {latestPrice.unit ?? 'unit'}
                      </p>
                    )}
                    {hasRating && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {(sp.ratingNum as number).toLocaleString()} review{sp.ratingNum !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>

                  {/* Sparkline */}
                  {sparklineData.length >= 2 && (
                    <div className="shrink-0">
                      <Sparkline data={sparklineData} width={64} height={20} />
                    </div>
                  )}

                  {/* Score badge */}
                  {score10 != null && (
                    <ScoreBadge score={score10} />
                  )}

                  {/* External link icon */}
                  {sp.sourceUrl && (
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </Row>
              )
            })}
          </div>
        </AccordionSection>
      )}



      {/* ═══ Ingredients ═══ */}
      {ingredientItems.length > 0 && (
        <AccordionSection
          title="Ingredients"
          trailing={<span className="text-xs text-muted-foreground">{ingredientItems.length}</span>}
          defaultOpen
        >
          <IngredientChipGroup items={ingredientItems} />
        </AccordionSection>
      )}


    </div>
  )
}
