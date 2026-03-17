/**
 * Stage 3: Side Detection
 *
 * For each scene, takes the detection crops from stage 2 (object_detection)
 * and:
 *   1. Classifies each crop as front/back/unknown using Grounding DINO
 *      with targeted prompts (brand logo vs ingredient list)
 *   2. Clusters crops per side using DINOv2 embedding cosine similarity
 *   3. Picks the best representative per side-cluster (highest detection score)
 *
 * This ensures downstream stages (visual_search, llm_recognition) work with
 * front-of-package crops rather than back-of-package ingredient lists.
 *
 * Uses the shared Grounding DINO singleton from @/lib/models/grounding-dino
 * and the shared DINOv2-small singleton from @/lib/models/clip.
 */

import { getDetector } from '@/lib/models/grounding-dino'
import { computeImageEmbedding } from '@/lib/models/clip'
import type { StageContext, StageResult } from './index'

/** Grounding DINO prompts for front-of-package signals */
const FRONT_PROMPTS = ['brand logo.', 'product name label.']
/** Grounding DINO prompt for back-of-package signals */
const BACK_PROMPT = 'ingredient list. small text.'

/**
 * Cosine distance threshold for clustering crops of the same side.
 * Crops within this distance are considered the same product view.
 */
const CLUSTER_DISTANCE_THRESHOLD = 0.4

interface CropInfo {
  /** Index into the scene's objects[] array */
  objectIndex: number
  /** Detection crop media URL */
  cropUrl: string
  /** Detection crop media ID */
  cropId: number
  /** Original detection score from Grounding DINO */
  detectionScore: number
  /** Classified side */
  side: 'front' | 'back' | 'unknown'
  /** Front-vs-back score (higher = more likely front) */
  representativeScore: number
  /** DINOv2 embedding (384-dim), computed for clustering */
  embedding: number[] | null
  /** Assigned cluster group (per side) */
  clusterGroup: number
  /** Whether this crop is the representative for its cluster */
  isRepresentative: boolean
}

export async function executeSideDetection(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)
  const detectionThreshold = config.detectionThreshold ?? 0.3

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Load models
  log.info('Loading models for side detection')
  const detector = await getDetector()
  log.info('Models ready for side detection')

  // Fetch all scenes for this video
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    log.info('No scenes found, skipping side detection', { videoId })
    return { success: true }
  }

  let totalObjects = 0
  let totalFront = 0
  let totalBack = 0
  let totalUnknown = 0
  let totalClusters = 0
  let totalRepresentatives = 0
  const serverUrl = payload.serverUrl

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number
    const objects = scene.objects as Array<{
      id?: string
      frame?: number | Record<string, unknown>
      crop: number | { id: number; url?: string }
      score?: number
      boxXMin?: number
      boxYMin?: number
      boxXMax?: number
      boxYMax?: number
    }> | null

    if (!objects || objects.length === 0) continue

    // Phase 1: Classify each crop as front/back using Grounding DINO
    const cropInfos: CropInfo[] = []

    for (let objIdx = 0; objIdx < objects.length; objIdx++) {
      const obj = objects[objIdx]

      // Resolve crop media URL
      const cropRef = obj.crop
      let cropUrl: string | undefined
      let cropId: number

      if (typeof cropRef === 'number') {
        cropId = cropRef
        const mediaDoc = (await payload.findByID({ collection: 'detection-media', id: cropId })) as Record<string, unknown>
        cropUrl = mediaDoc.url as string | undefined
      } else {
        cropId = cropRef.id
        cropUrl = cropRef.url
      }

      if (!cropUrl) {
        log.debug('No crop URL for object, skipping', { sceneId, objIdx })
        continue
      }

      const fullCropUrl = cropUrl.startsWith('http') ? cropUrl : `${serverUrl}${cropUrl}`

      // Run Grounding DINO with front and back prompts
      let frontScore = 0
      let backScore = 0

      try {
        // Front signals: brand logo + product name label
        for (const prompt of FRONT_PROMPTS) {
          const detections = await detector(fullCropUrl, [prompt], { threshold: detectionThreshold })
          if (detections && detections.length > 0) {
            const maxScore = Math.max(...detections.map((d) => d.score))
            frontScore += maxScore
          }
        }

        // Back signal: ingredient list / small text
        const backDetections = await detector(fullCropUrl, [BACK_PROMPT], { threshold: detectionThreshold })
        if (backDetections && backDetections.length > 0) {
          backScore = Math.max(...backDetections.map((d) => d.score))
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.debug('Side classification failed for crop', { sceneId, objIdx, error: msg })
      }

      const representativeScore = frontScore - backScore
      let side: 'front' | 'back' | 'unknown'
      if (frontScore > 0 && representativeScore > 0) {
        side = 'front'
        totalFront++
      } else if (backScore > 0 && representativeScore < 0) {
        side = 'back'
        totalBack++
      } else {
        side = 'unknown'
        totalUnknown++
      }
      totalObjects++

      jlog.event('video_processing.side_classified', {
        title,
        sceneId,
        objectIndex: objIdx,
        side,
        frontScore: Math.round(frontScore * 1000) / 1000,
        backScore: Math.round(backScore * 1000) / 1000,
        representativeScore: Math.round(representativeScore * 1000) / 1000,
      })

      cropInfos.push({
        objectIndex: objIdx,
        cropUrl: fullCropUrl,
        cropId,
        detectionScore: obj.score ?? 0,
        side,
        representativeScore,
        embedding: null,
        clusterGroup: -1,
        isRepresentative: false,
      })

      await ctx.heartbeat()
    }

    // Phase 2: Compute DINOv2 embeddings for clustering
    for (const crop of cropInfos) {
      try {
        crop.embedding = await computeImageEmbedding(crop.cropUrl)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.debug('Embedding failed for crop', { sceneId, objIdx: crop.objectIndex, error: msg })
      }
    }

    // Phase 3: Cluster crops per side using embedding cosine distance
    // Group crops by side first
    const sides: Array<'front' | 'back' | 'unknown'> = ['front', 'back', 'unknown']
    let globalClusterOffset = 0

    for (const side of sides) {
      const sideCrops = cropInfos.filter((c) => c.side === side && c.embedding !== null)
      if (sideCrops.length === 0) continue

      // Greedy nearest-neighbor clustering by cosine distance
      const clusterReps: { embedding: number[]; group: number; bestCropIndex: number }[] = []

      for (let i = 0; i < sideCrops.length; i++) {
        const crop = sideCrops[i]
        const embedding = crop.embedding!

        let bestDistance: number | null = null
        let bestGroup = -1

        for (const rep of clusterReps) {
          const distance = cosineDistance(embedding, rep.embedding)
          if (bestDistance === null || distance < bestDistance) {
            bestDistance = distance
            bestGroup = rep.group
          }
        }

        if (bestDistance !== null && bestDistance <= CLUSTER_DISTANCE_THRESHOLD) {
          crop.clusterGroup = bestGroup + globalClusterOffset

          // Check if this crop should replace the current rep (higher detection score)
          const currentRep = clusterReps.find((r) => r.group === bestGroup)!
          const currentRepCrop = sideCrops[currentRep.bestCropIndex]
          if (crop.detectionScore > currentRepCrop.detectionScore) {
            currentRepCrop.isRepresentative = false
            crop.isRepresentative = true
            currentRep.bestCropIndex = i
          }
        } else {
          // New cluster
          const newGroup = clusterReps.length
          crop.clusterGroup = newGroup + globalClusterOffset
          crop.isRepresentative = true
          clusterReps.push({ embedding, group: newGroup, bestCropIndex: i })
        }
      }

      totalClusters += clusterReps.length
      totalRepresentatives += clusterReps.length
      globalClusterOffset += clusterReps.length
    }

    // Handle crops without embeddings — each gets its own cluster, marked as representative
    for (const crop of cropInfos) {
      if (crop.clusterGroup === -1) {
        crop.clusterGroup = globalClusterOffset++
        crop.isRepresentative = true
        totalClusters++
        totalRepresentatives++
      }
    }

    // Phase 4: Write side + cluster + representative data back to the scene's objects[]
    // We need to preserve the existing object data and add the new fields
    const updatedObjects = objects.map((obj, idx) => {
      const cropInfo = cropInfos.find((c) => c.objectIndex === idx)
      return {
        ...obj,
        // Resolve relationships to just IDs for the update
        frame: typeof obj.frame === 'number' ? obj.frame : (obj.frame as { id: number })?.id,
        crop: typeof obj.crop === 'number' ? obj.crop : (obj.crop as { id: number })?.id,
        // New fields from side detection
        side: cropInfo?.side ?? 'unknown',
        clusterGroup: cropInfo?.clusterGroup ?? 0,
        isRepresentative: cropInfo?.isRepresentative ?? false,
      }
    })

    await payload.update({
      collection: 'video-scenes',
      id: sceneId,
      data: { objects: updatedObjects },
    })

    log.info('Side detection for scene', {
      sceneId,
      objects: objects.length,
      front: cropInfos.filter((c) => c.side === 'front').length,
      back: cropInfos.filter((c) => c.side === 'back').length,
      unknown: cropInfos.filter((c) => c.side === 'unknown').length,
      clusters: totalClusters,
      representatives: cropInfos.filter((c) => c.isRepresentative).length,
    })

    await ctx.heartbeat()
  }

  // Emit aggregate event
  jlog.event('video_processing.side_detection_complete', {
    title,
    totalObjects,
    front: totalFront,
    back: totalBack,
    unknown: totalUnknown,
    clusters: totalClusters,
    representatives: totalRepresentatives,
  })

  log.info('Side detection stage complete', {
    videoId,
    totalObjects,
    front: totalFront,
    back: totalBack,
    unknown: totalUnknown,
    clusters: totalClusters,
    representatives: totalRepresentatives,
  })
  return { success: true }
}

/**
 * Compute cosine distance between two vectors.
 * Returns 0 for identical vectors, 2 for opposite vectors.
 */
function cosineDistance(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 2
  return 1 - dotProduct / denominator
}
