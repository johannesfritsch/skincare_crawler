import { getPayload } from 'payload'
import config from '@payload-config'
import { eq, sql, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ThumbsUp,
  ThumbsDown,
  Minus,
  TrendingUp,
  TrendingDown,
  Star,
  Video,
  Play,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StoreLogo } from '@/components/store-logos'
import { Sparkline } from '@/components/sparkline'
import { ProductVideoList, type ProductVideoItem } from '@/components/product-video-list'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sentimentColor(s: string | null) {
  switch (s) {
    case 'positive': return 'text-emerald-600'
    case 'negative': return 'text-red-500'
    case 'mixed': return 'text-amber-500'
    default: return 'text-muted-foreground'
  }
}

function sentimentBg(s: string | null) {
  switch (s) {
    case 'positive': return 'bg-emerald-50 border-emerald-200/60'
    case 'negative': return 'bg-red-50 border-red-200/60'
    case 'mixed': return 'bg-amber-50 border-amber-200/60'
    default: return 'bg-muted/30 border-border'
  }
}

function SentimentIcon({ sentiment, className }: { sentiment: string | null; className?: string }) {
  const cls = cn(sentimentColor(sentiment), className)
  switch (sentiment) {
    case 'positive': return <ThumbsUp className={cls} />
    case 'negative': return <ThumbsDown className={cls} />
    case 'mixed': return <Minus className={cls} />
    default: return <Minus className={cls} />
  }
}

function formatPrice(cents: number | null): string {
  if (cents == null) return '—'
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`
}

function sentimentLabel(s: string | null): string {
  switch (s) {
    case 'positive': return 'Positive'
    case 'negative': return 'Negative'
    case 'mixed': return 'Mixed'
    default: return 'Neutral'
  }
}

/** Convert raw sentiment score (-1 to +1) to a 0–10 scale, rounded to 1 decimal. */
function toScore10(raw: number): string {
  const score = (raw + 1) * 5 // maps -1→0, 0→5, +1→10
  return score.toFixed(1)
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
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
      categoryName: t.categories.name,
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
    .leftJoin(t.categories, eq(t.products.category, t.categories.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .leftJoin(t.media, eq(t.products.image, t.media.id))
    .where(eq(t.products.gtin, gtin))
    .limit(1)

  if (!product) notFound()
  const productId = product.id as number

  /* ── Run parallel queries ── */
  const [ingredients, claims, attributes, sourceProducts, videoMentions, creatorStats] = await Promise.all([
    /* Ingredients */
    db.select({ name: t.products_ingredients.name })
      .from(t.products_ingredients)
      .where(eq(t.products_ingredients._parentID, productId)),

    /* Claims */
    db.select({
      claim: t.products_product_claims.claim,
      evidenceType: t.products_product_claims.evidenceType,
      snippet: t.products_product_claims.snippet,
    }).from(t.products_product_claims)
      .where(eq(t.products_product_claims._parentID, productId)),

    /* Attributes */
    db.select({
      attribute: t.products_product_attributes.attribute,
      evidenceType: t.products_product_attributes.evidenceType,
      snippet: t.products_product_attributes.snippet,
    }).from(t.products_product_attributes)
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
      quoteCount: sql<number>`(
        SELECT count(*) FROM video_mentions_quotes
        WHERE video_mentions_quotes._parent_id = ${t.video_mentions.id}
      )::int`,
    }).from(t.video_mentions)
      .innerJoin(t.video_snippets, eq(t.video_mentions.videoSnippet, t.video_snippets.id))
      .innerJoin(t.videos, eq(t.video_snippets.video, t.videos.id))
      .leftJoin(t.channels, eq(t.videos.channel, t.channels.id))
      .leftJoin(t.creators, eq(t.channels.creator, t.creators.id))
      .where(eq(t.video_mentions.product, productId))
      .orderBy(desc(t.videos.publishedAt)),

    /* Creator-level sentiment stats for this product */
    db.select({
      creatorId: t.creators.id,
      creatorName: t.creators.name,
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
      .groupBy(t.creators.id, t.creators.name, t.channels.id),
  ])

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

  /* ── Aggregate sentiment ── */
  const totalMentions = videoMentions.length
  const avgSentiment = totalMentions > 0
    ? videoMentions.reduce((sum, m) => sum + ((m.overallSentimentScore as number | null) ?? 0), 0) / totalMentions
    : null
  const sentimentCounts = {
    positive: videoMentions.filter(m => m.overallSentiment === 'positive').length,
    negative: videoMentions.filter(m => m.overallSentiment === 'negative').length,
    neutral: videoMentions.filter(m => m.overallSentiment === 'neutral').length,
    mixed: videoMentions.filter(m => m.overallSentiment === 'mixed').length,
  }
  const dominantSentiment = totalMentions > 0
    ? Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0][0]
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
    quoteCount: m.quoteCount,
    timestampStart: m.timestampStart as number | null,
  }))

  /* ── Featured videos (up to 6 most recent) ── */
  const featuredVideos = videoItems.slice(0, 6)

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

  /* ── Render ── */
  const details: [string, string | null][] = [
    ['Brand', product.brandName],
    ['Category', product.categoryName],
    ['Product Type', product.productTypeName],
  ]

  const typedCreatorStats = creatorStats as Array<{
    creatorId: number | null
    creatorName: string | null
    channelImageUrl: string | null
    mentionCount: number
    avgSentimentScore: number | null
    positiveCount: number
    negativeCount: number
    neutralCount: number
    mixedCount: number
  }>

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* ═══ Hero: image + name + sentiment badge ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
        {product.imageUrl && (
          <div className="shrink-0 self-center sm:self-start w-40 sm:w-48 aspect-square rounded-2xl bg-muted/50 overflow-hidden p-4">
            <Image
              src={product.imageUrl}
              alt={product.imageAlt || product.name || 'Product image'}
              width={product.imageWidth || 780}
              height={product.imageHeight || 780}
              className="h-full w-full object-contain"
              sizes="(min-width: 640px) 192px, 160px"
              priority
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{product.name || 'Unnamed product'}</h1>
          {product.brandName && (
            <p className="text-sm text-muted-foreground mt-0.5">{product.brandName}</p>
          )}

          {/* Creator score — prominent, right in the hero */}
          {totalMentions > 0 && avgSentiment != null && (
            <div className={cn(
              'inline-flex items-center gap-2.5 mt-3 rounded-xl border px-3.5 py-2',
              sentimentBg(dominantSentiment),
            )}>
              <div className="flex flex-col">
                <span className={cn('text-xl font-bold leading-tight', sentimentColor(dominantSentiment))}>
                  {toScore10(avgSentiment)}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {sentimentLabel(dominantSentiment)} &middot; {totalMentions} mention{totalMentions !== 1 ? 's' : ''}
                </span>
              </div>
              {/* Creator avatars */}
              {typedCreatorStats.length > 0 && (
                <div className="flex items-center -space-x-1.5 ml-1 pl-2.5 border-l border-current/10">
                  {typedCreatorStats
                    .sort((a, b) => b.mentionCount - a.mentionCount)
                    .slice(0, 5)
                    .map((cs) => (
                      <Avatar key={cs.creatorId ?? 'unknown'} size="sm" className="size-6 ring-2 ring-background">
                        {cs.channelImageUrl && <AvatarImage src={cs.channelImageUrl} alt={cs.creatorName ?? ''} />}
                        <AvatarFallback className="text-[7px]">
                          {(cs.creatorName ?? '?').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  {typedCreatorStats.length > 5 && (
                    <span className="flex items-center justify-center size-6 rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
                      +{typedCreatorStats.length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick detail pills */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {details.map(([label, value]) =>
              value ? (
                <Badge key={label} variant="secondary" className="text-xs">
                  {value}
                </Badge>
              ) : null,
            )}
            {claims.map((c, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {c.claim}
              </Badge>
            ))}
          </div>

          {product.gtin && (
            <p className="text-muted-foreground mt-2">
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{product.gtin}</code>
            </p>
          )}
        </div>
      </div>

      {/* ═══ Description ═══ */}
      {product.description && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Description</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{product.description}</p>
        </section>
      )}

      {/* ═══ Featured Videos (horizontal scroll) ═══ */}
      {featuredVideos.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Latest Videos</h2>
            </div>
            <span className="text-xs text-muted-foreground">{videoItems.length} total</span>
          </div>
          <div className="overflow-x-auto -mx-4 snap-x snap-mandatory scroll-pl-4 scrollbar-none">
            <div className="inline-flex gap-3 px-4 pb-1">
              {featuredVideos.map((v, i) => (
                <Link
                  key={`feat-${v.videoId}-${i}`}
                  href={`/videos/${v.videoId}`}
                  className="snap-start shrink-0 w-52 rounded-xl border bg-card overflow-hidden transition-colors active:bg-muted/60"
                >
                  {/* Thumbnail */}
                  <div className="relative w-full aspect-video bg-muted/50">
                    {v.videoThumbnailUrl ? (
                      <img
                        src={v.videoThumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="h-6 w-6 text-muted-foreground/30" />
                      </div>
                    )}
                    {v.videoDuration != null && v.videoDuration > 0 && (
                      <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                        {formatDuration(v.videoDuration)}
                      </span>
                    )}
                    {v.overallSentiment && (
                      <span className={cn(
                        'absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 border backdrop-blur-sm',
                        v.overallSentiment === 'positive' ? 'bg-emerald-50/90 text-emerald-700 border-emerald-200/60' :
                        v.overallSentiment === 'negative' ? 'bg-red-50/90 text-red-700 border-red-200/60' :
                        v.overallSentiment === 'mixed' ? 'bg-amber-50/90 text-amber-700 border-amber-200/60' :
                        'bg-muted/90 text-muted-foreground border-border',
                      )}>
                        <SentimentIcon sentiment={v.overallSentiment} className="h-2.5 w-2.5" />
                        {v.overallSentiment}
                      </span>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2.5">
                    <p className="text-xs font-medium leading-tight line-clamp-2">{v.videoTitle}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Avatar size="sm" className="size-4">
                        {v.channelImageUrl && (
                          <AvatarImage src={v.channelImageUrl} alt={v.creatorName ?? ''} />
                        )}
                        <AvatarFallback className="text-[7px]">
                          {(v.creatorName ?? '?').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[11px] text-muted-foreground truncate">{v.creatorName ?? 'Unknown'}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══ Per-Creator Sentiment ═══ */}
      {typedCreatorStats.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">By Creator</h2>
          <div className="overflow-x-auto -mx-4 snap-x scroll-pl-4 scrollbar-none">
            <div className="inline-flex gap-2.5 px-4 pb-1">
              {typedCreatorStats
                .sort((a, b) => b.mentionCount - a.mentionCount)
                .map((cs) => {
                  const dominant = cs.positiveCount >= cs.negativeCount && cs.positiveCount >= cs.mixedCount
                    ? 'positive'
                    : cs.negativeCount >= cs.positiveCount && cs.negativeCount >= cs.mixedCount
                      ? 'negative'
                      : cs.mixedCount > 0 ? 'mixed' : 'neutral'
                  return (
                    <div
                      key={cs.creatorId ?? 'unknown'}
                      className={cn(
                        'snap-start shrink-0 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 min-w-[180px]',
                        sentimentBg(dominant),
                      )}
                    >
                      <Avatar size="sm">
                        {cs.channelImageUrl && <AvatarImage src={cs.channelImageUrl} alt={cs.creatorName ?? ''} />}
                        <AvatarFallback className="text-[9px]">
                          {(cs.creatorName ?? '?').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{cs.creatorName ?? 'Unknown'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {cs.mentionCount} mention{cs.mentionCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <SentimentIcon sentiment={dominant} className="h-4 w-4" />
                        <span className={cn('text-sm font-semibold', sentimentColor(dominant))}>
                          {cs.avgSentimentScore != null
                            ? toScore10(Number(cs.avgSentimentScore))
                            : '—'}
                        </span>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </section>
      )}

      {/* ═══ Prices & Store Availability ═══ */}
      {sourceProducts.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Prices & Stores</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

              return (
                <div key={sp.id} className="flex items-start gap-3 rounded-xl border bg-card p-3.5">
                  {/* Store logo — left column */}
                  <div className="shrink-0 flex items-center justify-center w-20 pt-0.5">
                    <StoreLogo source={sp.source ?? ''} />
                  </div>

                  {/* Price + sparkline — right column */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold">
                        {formatPrice(latestPrice?.amount as number | null)}
                      </span>
                      {priceChange != null && priceChange !== 0 && (
                        <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', priceChange < 0 ? 'text-emerald-600' : 'text-red-500')}>
                          {priceChange < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                          {formatPrice(Math.abs(priceChange))}
                        </span>
                      )}
                    </div>

                    {/* Per unit price */}
                    {latestPrice?.perUnitAmount != null && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatPrice(latestPrice.perUnitAmount as number)} / {latestPrice.perUnitQuantity ?? 1} {latestPrice.unit ?? 'unit'}
                      </p>
                    )}

                    {/* Store rating */}
                    {sp.rating != null && sp.ratingNum != null && sp.ratingNum > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {Number(sp.rating).toFixed(1)} ({sp.ratingNum})
                      </div>
                    )}

                    {/* Sparkline */}
                    {sparklineData.length >= 2 && (
                      <div className="mt-2">
                        <Sparkline data={sparklineData} width={100} height={24} />
                      </div>
                    )}
                  </div>

                  {/* External link */}
                  {sp.sourceUrl && (
                    <a
                      href={sp.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      title={`View on ${sp.source}`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ═══ All Video Mentions ═══ */}
      {videoItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Video className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">All Video Mentions</h2>
            <Badge variant="secondary" className="text-xs ml-auto">
              {videoItems.length} video{videoItems.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <ProductVideoList videos={videoItems} />
        </section>
      )}

      <Separator />

      {/* ═══ Ingredients ═══ */}
      <section>
        <h2 className="text-lg font-semibold mb-2">
          Ingredients
          <span className="text-muted-foreground font-normal text-sm ml-2">({ingredients.length})</span>
        </h2>
        {ingredients.length > 0 ? (
          <p className="text-sm leading-relaxed">
            {ingredients.map((ing, i) => (
              <span key={i}>
                {ing.name}
                {i < ingredients.length - 1 && <span className="text-muted-foreground">, </span>}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No ingredients listed</p>
        )}
      </section>

      {/* ═══ Attributes ═══ */}
      {attributes.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Attributes</h2>

          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {attributes.map((a, i) => (
              <div key={i} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-medium text-sm">{a.attribute}</p>
                  <Badge variant="outline" className="text-xs shrink-0">{a.evidenceType}</Badge>
                </div>
                {a.snippet && (
                  <p className="text-xs text-muted-foreground mt-1">{a.snippet}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attribute</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Snippet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attributes.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{a.attribute}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.evidenceType}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {a.snippet || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  )
}
