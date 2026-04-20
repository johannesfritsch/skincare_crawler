/**
 * Gallery crawl — crawl a single Instagram gallery post URL.
 *
 * Fetches post metadata via gallery-dl, resolves/creates channel + creator,
 * downloads images, uploads to gallery-media, creates Gallery + GalleryItem records.
 *
 * Mirrors the video crawl metadata stage pattern (channel/creator resolution,
 * avatar download, thumbnail upload).
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
 * Crawl a single gallery post URL.
 *
 * 1. Fetch metadata via gallery-dl
 * 2. Resolve/create channel + creator
 * 3. Download images and upload to gallery-media
 * 4. Create Gallery record
 * 5. Create GalleryItem records
 */
export async function crawlGallery(
  galleryUrl: string,
  payload: PayloadRestClient,
  jlog: Logger,
  uploadMedia: (filePath: string, alt: string, mimetype: string, collection?: string) => Promise<number>,
  heartbeat: () => Promise<void>,
): Promise<CrawlGalleryResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-gallery-crawl-'))

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

    // Step 3: Download images and upload to gallery-media
    const uploadedMediaIds: number[] = []
    for (let i = 0; i < meta.imageUrls.length; i++) {
      const imageUrl = meta.imageUrls[i]
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

    // Step 4: Create or update Gallery record
    // Check if gallery already exists (by externalUrl)
    const existingGallery = await payload.find({
      collection: 'galleries',
      where: { externalUrl: { equals: galleryUrl } },
      limit: 1,
    })

    let galleryId: number
    const galleryData: Record<string, unknown> = {
      status: 'crawled',
      channel: channelId,
      externalId: meta.externalId,
      caption: meta.caption || undefined,
      ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
      ...(meta.likeCount != null ? { likeCount: meta.likeCount } : {}),
      ...(meta.commentCount != null ? { commentCount: meta.commentCount } : {}),
      ...(uploadedMediaIds.length > 0 ? { thumbnail: uploadedMediaIds[0] } : {}),
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

    // Step 5: Create GalleryItem records (one per image)
    // Delete existing items first (for re-crawl)
    if (existingGallery.docs.length > 0) {
      await payload.delete({
        collection: 'gallery-items',
        where: { gallery: { equals: galleryId } },
      }).catch((e: unknown) => jlog.warn('Failed to delete existing gallery items', { error: String(e) }))
    }

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

    jlog.info('Gallery crawled', { galleryId, items: uploadedMediaIds.length, caption: (meta.caption ?? '').slice(0, 80) })

    return {
      success: true,
      galleryId,
      itemCount: uploadedMediaIds.length,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}
