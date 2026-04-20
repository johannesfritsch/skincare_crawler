/**
 * Stage-based gallery processing pipeline.
 *
 * Each stage reads its input from the DB (prior stage's persisted output),
 * does its work, and persists results immediately.
 *
 * Progress is tracked on the job's `galleryProgress` JSON field — a map of
 * `{ [galleryId]: lastCompletedStageName }`. Galleries have a `status` field
 * (discovered/crawled/processed) managed by the worker.
 *
 * Gallery items are flat — one image per item, no frames, no scene timestamps.
 * This is the key simplification vs video processing.
 *
 * Stage ordering (by index in GALLERY_STAGES array):
 *   0. barcode_scan         — Scan gallery item images for EAN barcodes → item.barcodes[]
 *   1. object_detection     — Grounding DINO on gallery item images → item.objects[]
 *   2. visual_search        — DINOv2 search, top-N candidates per crop → item.recognitions[]
 *   3. ocr_extraction       — Read text from crops via GPT-4.1-mini → item.objects[].ocrText
 *   4. compile_detections   — Product matching + LLM consolidation → item.detections[]
 *   5. sentiment_analysis   — LLM sentiment from caption/comments → gallery-mentions
 */

import type { PayloadRestClient } from '@/lib/payload-client'
import type { Logger } from '@/lib/logger'

// ─── Types ───

/** The 6 stage names (match the checkbox field names on GalleryProcessings minus 'stage' prefix) */
export type GalleryStageName =
  | 'barcode_scan'
  | 'object_detection'
  | 'visual_search'
  | 'ocr_extraction'
  | 'compile_detections'
  | 'sentiment_analysis'

/**
 * Per-gallery progress map stored on the job's `galleryProgress` JSON field.
 * Keys are gallery ID strings, values are the last completed stage name
 * (or null / absent if no stage has completed for that gallery).
 */
export type GalleryProgress = Record<string, GalleryStageName | null>

/** Job-level config passed to stages */
export interface GalleryStageConfig {
  jobId: number
  /** Minimum detection box area as a fraction (0-1) of the image area. Default: 0.25 (25%). */
  minBoxArea: number
  /** Grounding DINO confidence threshold (0-1). Default: 0.3. */
  detectionThreshold: number
  /** Grounding DINO text prompt for zero-shot detection. Default: "cosmetics packaging." */
  detectionPrompt: string
  /** Maximum cosine distance for DINOv2 similarity search (0-2). Default: 0.8. */
  searchThreshold: number
  /** Number of nearest neighbors to return per detection. Default: 3. */
  searchLimit: number
}

/** Context available to all stage functions */
export interface GalleryStageContext {
  payload: PayloadRestClient
  config: GalleryStageConfig
  log: Logger
  /** Refreshes claimedAt on the job to keep the claim alive during long operations. */
  heartbeat: () => Promise<void>
}

/** Result returned by each stage execution */
export interface GalleryStageResult {
  success: boolean
  error?: string
  /** Token counts keyed by category */
  tokens?: {
    recognition?: number
    sentiment?: number
    total?: number
  }
}

/** Stage definition */
export interface GalleryStageDefinition {
  name: GalleryStageName
  /** Index in the pipeline (0-based) — determines ordering */
  index: number
  /** The checkbox field name on the GalleryProcessings job */
  jobField: string
  /** Execute the stage for a single gallery */
  execute: (ctx: GalleryStageContext, galleryId: number) => Promise<GalleryStageResult>
}

// ─── Stage Registry ───

import { executeBarcodeScan } from './barcode-scan'
import { executeObjectDetection } from './object-detection'
import { executeVisualSearch } from './visual-search'
import { executeOcrExtraction } from './ocr-extraction'
import { executeCompileDetections } from './compile-detections'
import { executeSentimentAnalysis } from './sentiment-analysis'

/** All stages in pipeline order */
export const GALLERY_STAGES: GalleryStageDefinition[] = [
  {
    name: 'barcode_scan',
    index: 0,
    jobField: 'stageBarcodeScan',
    execute: executeBarcodeScan,
  },
  {
    name: 'object_detection',
    index: 1,
    jobField: 'stageObjectDetection',
    execute: executeObjectDetection,
  },
  {
    name: 'visual_search',
    index: 2,
    jobField: 'stageVisualSearch',
    execute: executeVisualSearch,
  },
  {
    name: 'ocr_extraction',
    index: 3,
    jobField: 'stageOcrExtraction',
    execute: executeOcrExtraction,
  },
  {
    name: 'compile_detections',
    index: 4,
    jobField: 'stageCompileDetections',
    execute: executeCompileDetections,
  },
  {
    name: 'sentiment_analysis',
    index: 5,
    jobField: 'stageSentimentAnalysis',
    execute: executeSentimentAnalysis,
  },
]

/** Map from stage name to its index for quick lookup */
const STAGE_INDEX: Record<GalleryStageName, number> = Object.fromEntries(
  GALLERY_STAGES.map((s) => [s.name, s.index]),
) as Record<GalleryStageName, number>

/**
 * Get the numeric index of a stage name. Returns -1 for null/undefined
 * (meaning no stage completed yet — before the first stage).
 */
export function galleryStageIndex(name: GalleryStageName | null | undefined): number {
  if (name == null) return -1
  return STAGE_INDEX[name] ?? -1
}

// ─── Stage Dispatch Functions ───

/**
 * Determine which stage a gallery needs next, given the job's enabled stages
 * and the gallery's last completed stage (from the job's galleryProgress map).
 *
 * Returns the next stage definition to run, or null if the gallery is fully done.
 */
export function getNextGalleryStage(
  lastCompleted: GalleryStageName | null | undefined,
  enabledStages: Set<GalleryStageName>,
): GalleryStageDefinition | null {
  const currentIdx = galleryStageIndex(lastCompleted)

  for (const stage of GALLERY_STAGES) {
    if (stage.index <= currentIdx) continue
    if (!enabledStages.has(stage.name)) continue
    return stage
  }

  return null
}

/**
 * Get the last enabled stage name for a job.
 */
export function getFinalGalleryStage(enabledStages: Set<GalleryStageName>): GalleryStageName | null {
  let last: GalleryStageName | null = null
  for (const stage of GALLERY_STAGES) {
    if (enabledStages.has(stage.name)) {
      last = stage.name
    }
  }
  return last
}

/**
 * Build the set of enabled stages from a job document.
 */
export function getEnabledGalleryStages(job: Record<string, unknown>): Set<GalleryStageName> {
  const stages = new Set<GalleryStageName>()
  if (job.stageBarcodeScan !== false) stages.add('barcode_scan')
  if (job.stageObjectDetection !== false) stages.add('object_detection')
  if (job.stageVisualSearch !== false) stages.add('visual_search')
  if (job.stageOcrExtraction !== false) stages.add('ocr_extraction')
  if (job.stageCompileDetections !== false) stages.add('compile_detections')
  if (job.stageSentimentAnalysis !== false) stages.add('sentiment_analysis')
  return stages
}

/**
 * Check if a gallery needs any more work for this job's enabled stages.
 */
export function galleryNeedsWork(
  lastCompleted: GalleryStageName | null | undefined,
  enabledStages: Set<GalleryStageName>,
): boolean {
  if (lastCompleted === '!failed' as GalleryStageName) return false
  return getNextGalleryStage(lastCompleted, enabledStages) !== null
}

/** Sentinel value stored in galleryProgress when a gallery has permanently failed */
export const GALLERY_FAILED_SENTINEL = '!failed'

/**
 * Read the galleryProgress map from a job document.
 */
export function getGalleryProgress(job: Record<string, unknown>): GalleryProgress {
  let raw = job.galleryProgress
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as GalleryProgress
  }
  return {}
}
