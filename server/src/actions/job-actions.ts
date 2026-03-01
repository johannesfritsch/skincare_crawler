'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

type JobResult = { success: boolean; jobId?: number; error?: string }

// ---------- Generic status poller ----------

const JOB_COLLECTIONS = [
  'product-crawls',
  'product-aggregations',
  'video-discoveries',
  'video-processings',
  'ingredient-crawls',
] as const

type JobCollection = (typeof JOB_COLLECTIONS)[number]

export async function getJobStatus(
  collection: JobCollection,
  jobId: number,
): Promise<{ status: string; errors?: number }> {
  const payload = await getPayload({ config })

  const job = await payload.findByID({
    collection,
    id: jobId,
    depth: 0,
  })

  return {
    status: job.status as string,
    errors: ('errors' in job ? (job.errors as number) : 0) ?? 0,
  }
}

// ---------- Source Product → Crawl ----------

export async function crawlSourceProduct(sourceProductId: number): Promise<JobResult> {
  const payload = await getPayload({ config })

  const sourceProduct = await payload.findByID({
    collection: 'source-products',
    id: sourceProductId,
  })

  if (!sourceProduct.source) {
    return { success: false, error: 'Source product has no source' }
  }

  const variants = await payload.find({
    collection: 'source-variants',
    where: {
      and: [
        { sourceProduct: { equals: sourceProductId } },
        { isDefault: { equals: true } },
      ],
    },
    limit: 1,
    depth: 0,
  })

  const defaultVariant = variants.docs[0]
  if (!defaultVariant?.sourceUrl) {
    return { success: false, error: 'Source product has no variant with a URL' }
  }

  const crawl = await payload.create({
    collection: 'product-crawls',
    data: {
      source: sourceProduct.source,
      type: 'selected_urls',
      urls: defaultVariant.sourceUrl,
      scope: 'recrawl',
      status: 'pending',
    },
  })

  return { success: true, jobId: crawl.id }
}

// ---------- Product → Aggregate ----------

export async function aggregateProduct(productId: number): Promise<JobResult> {
  const payload = await getPayload({ config })

  // Get GTINs from this product's variants
  const variants = await payload.find({
    collection: 'product-variants',
    where: { product: { equals: productId } },
    limit: 100,
    depth: 0,
  })

  const gtins = variants.docs.map((v) => v.gtin).filter(Boolean)
  if (gtins.length === 0) {
    return { success: false, error: 'Product has no variants with GTINs' }
  }

  const job = await payload.create({
    collection: 'product-aggregations',
    data: {
      type: 'selected_gtins',
      scope: 'full',
      gtins: gtins.join('\n'),
      language: 'de',
      status: 'pending',
    },
  })

  return { success: true, jobId: job.id }
}

// ---------- Video → Process ----------

export async function processVideo(videoId: number): Promise<JobResult> {
  const job = await (await getPayload({ config })).create({
    collection: 'video-processings',
    data: {
      type: 'single_video',
      video: videoId,
      status: 'pending',
    },
  })

  return { success: true, jobId: job.id }
}

// ---------- Channel → Discover Videos ----------

export async function discoverChannelVideos(channelId: number): Promise<JobResult> {
  const payload = await getPayload({ config })

  const channel = await payload.findByID({
    collection: 'channels',
    id: channelId,
    depth: 0,
  })

  if (!channel.externalUrl) {
    return { success: false, error: 'Channel has no external URL' }
  }

  const job = await payload.create({
    collection: 'video-discoveries',
    data: {
      channelUrl: channel.externalUrl,
      status: 'pending',
    },
  })

  return { success: true, jobId: job.id }
}

// ---------- Ingredient → Crawl Info ----------

export async function crawlIngredient(ingredientId: number): Promise<JobResult> {
  const job = await (await getPayload({ config })).create({
    collection: 'ingredient-crawls',
    data: {
      type: 'selected',
      ingredientIds: [ingredientId],
      status: 'pending',
    },
  })

  return { success: true, jobId: job.id }
}
