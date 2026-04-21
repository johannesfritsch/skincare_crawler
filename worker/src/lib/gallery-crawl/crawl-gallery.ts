/**
 * Gallery crawl — crawl a single Instagram gallery post URL.
 *
 * Split into two independently callable stages:
 *   1. crawlGalleryMetadata() — gallery-dl metadata + channel/creator resolution
 *   2. crawlGalleryDownload() — image download + gallery items creation
 *
 * The combined crawlGallery() wrapper calls both for backward compatibility.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { runGalleryDl, getCookies, type GalleryDlEntry } from '@/lib/video-discovery/drivers/gallery-dl'
import type { PayloadRestClient } from '@/lib/payload-client'
import type { Logger } from '@/lib/logger'

export interface CrawlGalleryResult {
  success: boolean
  galleryId?: number
  itemCount?: number
  error?: string
}

export interface CrawlGalleryMetadataResult {
  success: boolean
  galleryId?: number
  error?: string
}

export interface CrawlGalleryDownloadResult {
  success: boolean
  itemCount?: number
  error?: string
}

interface ParsedGalleryMetadata {
  externalId: string
  caption: string
  likeCount?: number
  commentCount?: number
  publishedAt?: string
  channelName?: string
  channelUrl?: string
  channelAvatarUrl?: string
  imageUrls: string[]
  thumbnailUrl?: string
}

/** Extract gallery metadata from gallery-dl entries */
function parseGalleryEntries(entries: GalleryDlEntry[]): ParsedGalleryMetadata | null {
  if (entries.length === 0) return null

  // Find the post-level metadata entry (index=2, no URL) — has post_id, owner, description, likes
  const metaEntry = entries.find(e => !e.url) ?? entries[0]
  if (!metaEntry) return null
  const d = metaEntry.data

  const postId = String(d.post_id ?? d.media_id ?? '')
  if (!postId) return null

  const caption = (d.description as string) ?? ''

  const postDate = (d.post_date as string) ?? (d.date as string) ?? ''
  let publishedAt: string | undefined
  if (postDate) {
    const parsed = new Date(postDate)
    if (!isNaN(parsed.getTime())) publishedAt = parsed.toISOString()
  }

  const owner = d.owner as Record<string, unknown> | undefined
  const hdPic = owner?.hd_profile_pic_url_info as Record<string, unknown> | undefined
  const username = (d.username as string) ?? ''

  // Collect all image URLs from media entries (index=3 entries with non-mp4 extension)
  const imageUrls: string[] = []
  const seenUrls = new Set<string>()
  for (const entry of entries) {
    if (!entry.url) continue
    const ext = (entry.data.extension as string) ?? ''
    if (ext === 'mp4') continue // skip video files
    if (!seenUrls.has(entry.url)) {
      seenUrls.add(entry.url)
      imageUrls.push(entry.url)
    }
  }

  return {
    externalId: postId,
    caption,
    likeCount: (d.likes as number) ?? undefined,
    commentCount: (d.comments as number) ?? undefined,
    publishedAt,
    channelName: username || undefined,
    channelUrl: username ? `https://www.instagram.com/${username}/` : undefined,
    channelAvatarUrl: (hdPic?.url as string) ?? (owner?.profile_pic_url as string) ?? undefined,
    imageUrls,
    thumbnailUrl: (d.display_url as string) ?? undefined,
  }
}

/**
 * Stage 1: Fetch gallery-dl metadata and resolve/create channel + creator.
 *
 * - Runs gallery-dl with --no-download (metadata only)
 * - Resolves or creates channel + creator
 * - Downloads and uploads avatar
 * - Creates or updates Gallery record with metadata + imageSourceUrls
 * - Does NOT set status: 'crawled' — that happens in crawlGalleryDownload()
 *
 * Returns { success, galleryId, error? }
 */
export async function crawlGalleryMetadata(
  galleryUrl: string,
  payload: PayloadRestClient,
  jlog: Logger,
  uploadMedia: (filePath: string, alt: string, mimetype: string, collection?: string) => Promise<number>,
  heartbeat: () => Promise<void>,
): Promise<CrawlGalleryMetadataResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-gallery-meta-'))

  try {
    // Step 1: Fetch metadata via gallery-dl
    const cookies = await getCookies(payload, 'instagram')
    if (!cookies) {
      jlog.warn('No Instagram cookies configured in Crawler Settings')
    }

    const entries = await runGalleryDl({
      url: galleryUrl,
      cookies,
      platform: 'instagram',
      logger: jlog,
    })

    const meta = parseGalleryEntries(entries)
    if (!meta) {
      return { success: false, error: `No metadata returned from gallery-dl for ${galleryUrl}` }
    }

    await heartbeat()

    // Step 2: Resolve/create channel + creator (same pattern as video crawl metadata stage)
    let channelId: number | undefined
    if (meta.channelUrl) {
      const existingChannel = await payload.find({
        collection: 'channels',
        where: {
          or: [
            { externalUrl: { equals: meta.channelUrl } },
            { canonicalUrl: { equals: meta.channelUrl } },
          ],
        },
        limit: 1,
      })

      if (existingChannel.docs.length > 0) {
        channelId = (existingChannel.docs[0] as Record<string, unknown>).id as number
      } else {
        // Create creator first
        const creatorName = meta.channelName ?? 'Unknown'
        const existingCreator = await payload.find({
          collection: 'creators',
          where: { name: { equals: creatorName } },
          limit: 1,
        })
        let creatorId: number
        if (existingCreator.docs.length > 0) {
          creatorId = (existingCreator.docs[0] as Record<string, unknown>).id as number
        } else {
          const newCreator = await payload.create({
            collection: 'creators',
            data: { name: creatorName },
          }) as { id: number }
          creatorId = newCreator.id
        }

        // Download and upload avatar
        let channelImageId: number | undefined
        if (meta.channelAvatarUrl) {
          try {
            const avatarRes = await fetch(meta.channelAvatarUrl)
            if (avatarRes.ok) {
              const buffer = Buffer.from(await avatarRes.arrayBuffer())
              const contentType = avatarRes.headers.get('content-type') || 'image/jpeg'
              const ext = contentType.includes('png') ? 'png' : 'jpg'
              const avatarPath = path.join(tmpDir, `${crypto.randomUUID()}.${ext}`)
              fs.writeFileSync(avatarPath, buffer)
              channelImageId = await uploadMedia(avatarPath, 'avatar', contentType, 'profile-media')
            }
          } catch (e) {
            jlog.warn('Failed to download channel avatar', { error: String(e) })
          }
        }

        // Create channel
        const newChannel = await payload.create({
          collection: 'channels',
          data: {
            creator: creatorId,
            platform: 'instagram',
            externalUrl: meta.channelUrl,
            ...(channelImageId ? { image: channelImageId } : {}),
          },
        }) as { id: number }
        channelId = newChannel.id
      }
    }

    if (!channelId) {
      return { success: false, error: `Could not resolve channel for gallery ${galleryUrl} — no channel URL from metadata` }
    }

    await heartbeat()

    // Step 3: Create or update Gallery record with metadata + imageSourceUrls
    // Does NOT set status: 'crawled' here — that is set by crawlGalleryDownload()
    const existingGallery = await payload.find({
      collection: 'galleries',
      where: { externalUrl: { equals: galleryUrl } },
      limit: 1,
    })

    let galleryId: number
    const galleryData: Record<string, unknown> = {
      channel: channelId,
      externalId: meta.externalId,
      caption: meta.caption || undefined,
      ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
      ...(meta.likeCount != null ? { likeCount: meta.likeCount } : {}),
      ...(meta.commentCount != null ? { commentCount: meta.commentCount } : {}),
      imageSourceUrls: meta.imageUrls,
    }

    if (existingGallery.docs.length > 0) {
      galleryId = (existingGallery.docs[0] as Record<string, unknown>).id as number
      await payload.update({
        collection: 'galleries',
        id: galleryId,
        data: galleryData,
      })
    } else {
      const newGallery = await payload.create({
        collection: 'galleries',
        data: {
          ...galleryData,
          externalUrl: galleryUrl,
        },
      }) as { id: number }
      galleryId = newGallery.id
    }

    jlog.info('Gallery metadata fetched', { galleryId, imageCount: meta.imageUrls.length, caption: (meta.caption ?? '').slice(0, 80) })

    return { success: true, galleryId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

/**
 * Stage 2: Download images and create gallery-item records.
 *
 * - Looks up Gallery by externalUrl
 * - Reads imageSourceUrls from the Gallery record
 * - Downloads each image via HTTP, uploads to gallery-media
 * - Deletes existing gallery-items (for re-crawl), creates new ones
 * - Sets thumbnail to first uploaded image
 * - Sets status: 'crawled'
 *
 * Returns { success, itemCount, error? }
 */
export async function crawlGalleryDownload(
  galleryUrl: string,
  payload: PayloadRestClient,
  jlog: Logger,
  uploadMedia: (filePath: string, alt: string, mimetype: string, collection?: string) => Promise<number>,
  heartbeat: () => Promise<void>,
): Promise<CrawlGalleryDownloadResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-gallery-dl-'))

  try {
    // Look up Gallery by externalUrl
    const existingGallery = await payload.find({
      collection: 'galleries',
      where: { externalUrl: { equals: galleryUrl } },
      limit: 1,
    })

    if (existingGallery.docs.length === 0) {
      return { success: false, error: `Gallery not found for URL: ${galleryUrl} — run metadata stage first` }
    }

    const gallery = existingGallery.docs[0] as Record<string, unknown>
    const galleryId = gallery.id as number
    const imageSourceUrls = (gallery.imageSourceUrls as string[]) ?? []

    if (imageSourceUrls.length === 0) {
      jlog.warn('No imageSourceUrls on gallery — metadata stage may not have run', { galleryId })
      // Still mark as crawled with zero items
      await payload.update({
        collection: 'galleries',
        id: galleryId,
        data: { status: 'crawled' },
      })
      return { success: true, itemCount: 0 }
    }

    // Download images and upload to gallery-media
    const uploadedMediaIds: number[] = []
    for (let i = 0; i < imageSourceUrls.length; i++) {
      const imageUrl = imageSourceUrls[i]
      try {
        const imgRes = await fetch(imageUrl)
        if (!imgRes.ok) {
          jlog.warn('Failed to download gallery image', { url: imageUrl, status: imgRes.status })
          continue
        }
        const buffer = Buffer.from(await imgRes.arrayBuffer())
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
        const ext = contentType.includes('png') ? 'png' : (contentType.includes('webp') ? 'webp' : 'jpg')
        const imgPath = path.join(tmpDir, `${crypto.randomUUID()}.${ext}`)
        fs.writeFileSync(imgPath, buffer)

        const mediaId = await uploadMedia(imgPath, `gallery-image-${i}`, contentType, 'gallery-media')
        uploadedMediaIds.push(mediaId)
      } catch (e) {
        jlog.warn('Failed to download gallery image', { url: imageUrl, error: String(e) })
      }

      // Heartbeat every 5 images
      if ((i + 1) % 5 === 0) await heartbeat()
    }

    await heartbeat()

    // Delete existing gallery-items (for re-crawl)
    await payload.delete({
      collection: 'gallery-items',
      where: { gallery: { equals: galleryId } },
    }).catch((e: unknown) => jlog.warn('Failed to delete existing gallery items', { error: String(e) }))

    // Create gallery-item records
    for (let i = 0; i < uploadedMediaIds.length; i++) {
      await payload.create({
        collection: 'gallery-items',
        data: {
          gallery: galleryId,
          image: uploadedMediaIds[i],
          position: i,
        },
      })
    }

    // Set thumbnail + status: 'crawled'
    await payload.update({
      collection: 'galleries',
      id: galleryId,
      data: {
        status: 'crawled',
        ...(uploadedMediaIds.length > 0 ? { thumbnail: uploadedMediaIds[0] } : {}),
      },
    })

    jlog.info('Gallery images downloaded', { galleryId, items: uploadedMediaIds.length })

    return { success: true, itemCount: uploadedMediaIds.length }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

/**
 * Crawl a single gallery post URL (metadata + download in one call).
 *
 * Kept for backward compatibility — calls crawlGalleryMetadata() then crawlGalleryDownload().
 */
export async function crawlGallery(
  galleryUrl: string,
  payload: PayloadRestClient,
  jlog: Logger,
  uploadMedia: (filePath: string, alt: string, mimetype: string, collection?: string) => Promise<number>,
  heartbeat: () => Promise<void>,
): Promise<CrawlGalleryResult> {
  const metaResult = await crawlGalleryMetadata(galleryUrl, payload, jlog, uploadMedia, heartbeat)
  if (!metaResult.success) {
    return { success: false, error: metaResult.error }
  }

  const dlResult = await crawlGalleryDownload(galleryUrl, payload, jlog, uploadMedia, heartbeat)
  if (!dlResult.success) {
    return { success: false, galleryId: metaResult.galleryId, error: dlResult.error }
  }

  return {
    success: true,
    galleryId: metaResult.galleryId,
    itemCount: dlResult.itemCount,
  }
}
