import { getPayload } from 'payload'
import config from '@payload-config'
import { eq, sql, asc, inArray } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { VideoDetailClient, type VideoMentionItem, type VideoQuote } from '@/components/video-detail-client'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sceneId?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  const [video] = await db
    .select({ title: t.videos.title })
    .from(t.videos)
    .where(eq(t.videos.id, Number(id)))
    .limit(1)

  return {
    title: video ? `${video.title} — AnySkin` : 'Video — AnySkin',
  }
}

export default async function VideoDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { sceneId: sceneIdParam } = await searchParams
  const initialSceneId = sceneIdParam ? Number(sceneIdParam) : null
  const numericId = Number(id)
  if (!id || isNaN(numericId)) notFound()

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  /* ---- Fetch video ---- */
  const [video] = await db
    .select({
      id: t.videos.id,
      title: t.videos.title,
      publishedAt: t.videos.publishedAt,
      duration: t.videos.duration,
      viewCount: t.videos.viewCount,
      likeCount: t.videos.likeCount,
      externalUrl: t.videos.externalUrl,
      channelPlatform: t.channels.platform,
      creatorName: t.creators.name,
    })
    .from(t.videos)
    .leftJoin(t.channels, eq(t.videos.channel, t.channels.id))
    .leftJoin(t.creators, eq(t.channels.creator, t.creators.id))
    .where(eq(t.videos.id, numericId))
    .limit(1)

  if (!video) notFound()

  /* ---- Fetch scenes ---- */
  const scenes = await db
    .select({
      id: t.video_scenes.id,
      timestampStart: t.video_scenes.timestampStart,
      timestampEnd: t.video_scenes.timestampEnd,
      transcript: t.video_scenes.transcript,
    })
    .from(t.video_scenes)
    .where(eq(t.video_scenes.video, numericId))
    .orderBy(asc(t.video_scenes.timestampStart))

  const sceneIds = scenes.map((s) => s.id as number)

  /* ---- Fetch mentions with product data ---- */
  let mentionRows: {
    mentionId: number
    sceneId: number
    productId: number
    productName: string | null
    productGtin: string | null
    productImageUrl: string | null
    brandName: string | null
    overallSentiment: string | null
  }[] = []

  if (sceneIds.length > 0) {
    mentionRows = await db
      .select({
        mentionId: t.video_mentions.id,
        sceneId: t.video_mentions.videoScene,
        productId: t.video_mentions.product,
        productName: t.products.name,
        productGtin: sql<string | null>`(SELECT min(pv.gtin) FROM ${t.product_variants} pv WHERE pv.product_id = ${t.products.id})`,
        productImageUrl: sql<string | null>`coalesce(${t.product_media}.sizes_thumbnail_url, ${t.product_media}.url)`,
        brandName: t.brands.name,
        overallSentiment: t.video_mentions.overallSentiment,
      })
      .from(t.video_mentions)
      .leftJoin(t.products, eq(t.video_mentions.product, t.products.id))
      .leftJoin(t.product_variants, eq(t.product_variants.product, t.products.id))
      .leftJoin(t.product_variants_images, sql`${t.product_variants_images._parentID} = ${t.product_variants.id} AND ${t.product_variants_images._order} = 1`)
      .leftJoin(t.product_media, eq(t.product_variants_images.image, t.product_media.id))
      .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
      .where(inArray(t.video_mentions.videoScene, sceneIds))
  }

  /* ---- Fetch quotes for each mention ---- */
  const mentionIds = mentionRows.map((m) => m.mentionId as number)

  let quoteRows: {
    parentId: number
    text: string
    sentiment: string
    sentimentScore: number | null
  }[] = []

  if (mentionIds.length > 0) {
    quoteRows = await db
      .select({
        parentId: t.video_mentions_quotes._parentID,
        text: t.video_mentions_quotes.text,
        sentiment: t.video_mentions_quotes.sentiment,
        sentimentScore: t.video_mentions_quotes.sentimentScore,
      })
      .from(t.video_mentions_quotes)
      .where(inArray(t.video_mentions_quotes._parentID, mentionIds))
  }

  /* ---- Assemble into the shape the client component expects ---- */
  const quotesMap = new Map<number, VideoQuote[]>()
  for (const q of quoteRows) {
    const parentId = q.parentId as number
    if (!quotesMap.has(parentId)) quotesMap.set(parentId, [])
    quotesMap.get(parentId)!.push({
      text: q.text,
      sentiment: q.sentiment as VideoQuote['sentiment'],
      sentimentScore: q.sentimentScore,
    })
  }

  // Build a scene lookup
  const sceneLookup = new Map(scenes.map((s) => [s.id as number, s]))

  const mentions: VideoMentionItem[] = mentionRows.map((m) => {
    const scene = sceneLookup.get(m.sceneId as number)
    return {
      id: m.mentionId as number,
      productId: m.productId as number,
      productName: m.productName,
      productGtin: m.productGtin,
      productImageUrl: m.productImageUrl,
      brandName: m.brandName,
      overallSentiment: m.overallSentiment,
      quotes: quotesMap.get(m.mentionId as number) ?? [],
      sceneId: m.sceneId as number,
      timestampStart: (scene?.timestampStart as number) ?? null,
      timestampEnd: (scene?.timestampEnd as number) ?? null,
      sceneTranscript: (scene?.transcript as string) ?? null,
    }
  })

  return (
    <VideoDetailClient
      videoId={String(video.id)}
      title={video.title as string}
      creatorName={video.creatorName as string | null}
      channelPlatform={video.channelPlatform as string | null}
      publishedAt={video.publishedAt as string | null}
      viewCount={video.viewCount as number | null}
      likeCount={video.likeCount as number | null}
      externalUrl={video.externalUrl as string | null}
      mentions={mentions}
      initialSceneId={initialSceneId}
    />
  )
}
