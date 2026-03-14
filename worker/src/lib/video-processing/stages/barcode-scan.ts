/**
 * Stage 1: Barcode Scan
 *
 * Reads all video-frames for each scene, downloads each frame image,
 * scans for EAN barcodes via zbarimg, and writes results to the
 * scene's barcodes[] array. Resolves barcodes to product-variants
 * and products by GTIN lookup.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { scanBarcode } from '@/lib/video-processing/process-video'
import type { StageContext, StageResult } from './index'

export async function executeBarcodeScan(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Fetch all scenes for this video
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    log.info('No scenes found, skipping barcode scan', { videoId })
    return { success: true }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-barcode-'))
  const serverUrl = payload.serverUrl
  let totalBarcodes = 0

  try {
    for (const sceneDoc of scenesResult.docs) {
      const scene = sceneDoc as Record<string, unknown>
      const sceneId = scene.id as number

      // Fetch all frames for this scene
      const framesResult = await payload.find({
        collection: 'video-frames',
        where: { scene: { equals: sceneId } },
        limit: 1000,
      })
      const frames = framesResult.docs as Array<Record<string, unknown>>

      const barcodeEntries: Array<Record<string, unknown>> = []
      const seenBarcodes = new Set<string>()

      for (const frame of frames) {
        const frameId = frame.id as number
        const imageRef = frame.image as number | Record<string, unknown>
        const imageMediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id

        // Download frame image to temp file
        const mediaDoc = await payload.findByID({ collection: 'video-media', id: imageMediaId }) as Record<string, unknown>
        const mediaUrl = mediaDoc.url as string
        if (!mediaUrl) continue

        const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
        const imgRes = await fetch(fullUrl)
        if (!imgRes.ok) continue

        const localPath = path.join(tmpDir, `frame_${frameId}.jpg`)
        fs.writeFileSync(localPath, Buffer.from(await imgRes.arrayBuffer()))

        // Scan for barcode
        const barcode = await scanBarcode(localPath)
        if (barcode && !seenBarcodes.has(barcode)) {
          seenBarcodes.add(barcode)
          log.info('Barcode found', { sceneId, frameId, barcode })
          jlog.event('video_processing.barcode_found', { title, segment: sceneId, barcode })

          // Resolve GTIN → product-variant → product
          const entry: Record<string, unknown> = {
            barcode,
            frame: frameId,
          }

          const variants = await payload.find({
            collection: 'product-variants',
            where: { gtin: { equals: barcode } },
            limit: 1,
          })
          if (variants.docs.length > 0) {
            const variant = variants.docs[0] as Record<string, unknown>
            const variantId = variant.id as number
            const productRef = variant.product as number | Record<string, unknown>
            const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
            entry.productVariant = variantId
            entry.product = productId
            log.info('Barcode resolved to product', { barcode, productId, variantId })
          } else {
            log.info('No product-variant found for barcode', { barcode })
          }

          barcodeEntries.push(entry)
          totalBarcodes++
        }

        // Clean up temp file
        try { fs.unlinkSync(localPath) } catch { /* ignore */ }
      }

      // Write barcodes to the scene (overwrite for idempotency)
      if (barcodeEntries.length > 0) {
        await payload.update({
          collection: 'video-scenes',
          id: sceneId,
          data: { barcodes: barcodeEntries },
        })
      }

      await ctx.heartbeat()
    }

    log.info('Barcode scan stage complete', { videoId, totalBarcodes })
    return { success: true }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
