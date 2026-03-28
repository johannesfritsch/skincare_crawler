/**
 * Shared Apify API client for Instagram/TikTok video discovery drivers.
 *
 * Fetches dataset items and KV store records from completed Apify actor runs.
 * The token comes from APIFY_API_TOKEN env var.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('Apify')

const APIFY_BASE = 'https://api.apify.com/v2'

function getToken(): string {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN environment variable is not set')
  return token
}

interface ApifyRun {
  id: string
  status: string
  defaultDatasetId: string
  defaultKeyValueStoreId: string
  startedAt: string
  finishedAt: string
}

interface ApifyRunListResponse {
  data: {
    items: ApifyRun[]
    total: number
  }
}

interface ApifyKvKeyItem {
  key: string
  size: number
  recordPublicUrl: string
}

interface ApifyKvKeysResponse {
  data: {
    items: ApifyKvKeyItem[]
    count: number
    limit: number
    isTruncated: boolean
    nextExclusiveStartKey: string | null
  }
}

/**
 * Get the latest successful run for an actor.
 * Throws if no successful runs exist.
 */
export async function getLatestRun(actorId: string): Promise<ApifyRun> {
  const token = getToken()
  const url = `${APIFY_BASE}/acts/${actorId}/runs?status=SUCCEEDED&desc=true&limit=1&token=${token}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Apify API error: ${res.status} ${res.statusText} for actor ${actorId}`)
  }

  const data = (await res.json()) as ApifyRunListResponse
  if (!data.data.items.length) {
    throw new Error(`No successful runs found for Apify actor ${actorId}`)
  }

  return data.data.items[0]
}

/**
 * Fetch items from an Apify dataset with pagination.
 * Returns the raw array of items (the dataset items endpoint returns a plain JSON array).
 */
export async function fetchDatasetItems<T>(
  datasetId: string,
  offset: number,
  limit: number,
): Promise<T[]> {
  const token = getToken()
  const url = `${APIFY_BASE}/datasets/${datasetId}/items?offset=${offset}&limit=${limit}&token=${token}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Apify dataset fetch error: ${res.status} for dataset ${datasetId}`)
  }

  // Dataset items endpoint returns a plain JSON array
  return (await res.json()) as T[]
}

/**
 * List keys in a KV store with optional prefix filtering.
 */
export async function listKvStoreKeys(
  storeId: string,
  prefix?: string,
): Promise<ApifyKvKeyItem[]> {
  const token = getToken()
  const params = new URLSearchParams({ token, limit: '1000' })
  if (prefix) params.set('prefix', prefix)

  const allItems: ApifyKvKeyItem[] = []
  let exclusiveStartKey: string | null = null

  while (true) {
    const qp = new URLSearchParams(params)
    if (exclusiveStartKey) qp.set('exclusiveStartKey', exclusiveStartKey)

    const url = `${APIFY_BASE}/key-value-stores/${storeId}/keys?${qp.toString()}`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Apify KV store list error: ${res.status} for store ${storeId}`)
    }

    const data = (await res.json()) as ApifyKvKeysResponse
    allItems.push(...data.data.items)

    if (!data.data.isTruncated) break
    exclusiveStartKey = data.data.nextExclusiveStartKey
  }

  return allItems
}

/**
 * Get the direct download URL for a KV store record.
 */
export function getKvRecordUrl(storeId: string, key: string): string {
  const token = getToken()
  return `${APIFY_BASE}/key-value-stores/${storeId}/records/${encodeURIComponent(key)}?token=${token}`
}

export { log, type ApifyRun, type ApifyKvKeyItem }
