/**
 * Stage 0: Barcode Scan
 *
 * Downloads each gallery item's image, scans for EAN barcodes via zbarimg,
 * and writes results to the item's barcodes[] array. Resolves barcodes to
 * product-variants and products by GTIN lookup.
 *
 * Simplified vs video: one image per item, no frames iteration.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { scanBarcode } from '@/lib/video-processing/process-video'
import type { GalleryStageContext, GalleryStageResult } from './index'

export async function executeBarcodeScan(ctx: GalleryStageContext, galleryId: number): Promise<GalleryStageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('gallery-processings', config.jobId)

  // Fetch all items for this gallery
  const itemsResult = await payload.find({
    collection: 'gallery-items',
    where: { gallery: { equals: galleryId } },
    limit: 1000,
    sort: 'position',
  })

  if (itemsResult.docs.length === 0) {
    log.info('No gallery items found, skipping barcode scan', { galleryId })
    return { success: true }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-gallery-barcode-'))
  const serverUrl = payload.serverUrl
  let totalBarcodes = 0

  try {
    for (const itemDoc of itemsResult.docs) {
      const item = itemDoc as Record<string, unknown>
      const itemId = item.id as number
      const imageRef = item.image as number | Record<string, unknown> | null
      if (!imageRef) continue

      const imageMediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id

      // Download item image to temp file
      const mediaDoc = await payload.findByID({ collection: 'gallery-media', id: imageMediaId }) as Record<string, unknown>
      const mediaUrl = mediaDoc.url as string
      if (!mediaUrl) continue

      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
      const imgRes = await fetch(fullUrl)
      if (!imgRes.ok) continue

      const localPath = path.join(tmpDir, `item_${itemId}.jpg`)
      fs.writeFileSync(localPath, Buffer.from(await imgRes.arrayBuffer()))

      // Scan for barcode
      const barcode = await scanBarcode(localPath)
      const barcodeEntries: Array<Record<string, unknown>> = []

      if (barcode) {
        log.info('Barcode found', { galleryId, itemId, barcode })
        jlog.event('gallery_processing.barcode_found', { galleryId, itemId, barcode })

        const entry: Record<string, unknown> = { barcode }

        // Resolve GTIN → product-variant → product
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
        }

        barcodeEntries.push(entry)
        totalBarcodes++
      }

      // Write barcodes to the item (overwrite for idempotency)
      await payload.update({
        collection: 'gallery-items',
        id: itemId,
        data: { barcodes: barcodeEntries },
      })

      // Clean up temp file
      try { fs.unlinkSync(localPath) } catch { /* ignore */ }

      await ctx.heartbeat()
    }

    log.info('Barcode scan stage complete', { galleryId, totalBarcodes })
    return { success: true }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
