/**
 * Stage-based product aggregation pipeline.
 *
 * Each stage reads its input from the DB, does its work, and persists results
 * immediately. Progress is tracked on the job's `aggregationProgress` JSON field
 * — a map of `{ [productId]: lastCompletedStageName }`.
 *
 * Stage ordering (by index in STAGES array):
 *   0. resolve           — find/create product + variants, aggregate basic data
 *   1. classify          — LLM classification + clean product name
 *   2. match_brand       — LLM brand matching
 *   3. ingredients       — LLM ingredient parsing + matching per variant
 *   4. images            — download + upload best image per variant
 *   5. object_detection  — Grounding DINO detection + crop per variant
 *   6. embed_images      — DINOv2 embedding vectors for recognition image crops
 *   7. descriptions      — LLM consensus description + deduplicated labels per variant
 *   8. score_history     — compute store + creator scores
 */

import type { PayloadRestClient } from '@/lib/payload-client'
import type { Logger } from '@/lib/logger'
import type { AggregationSource } from '@/lib/aggregate-product'

// ─── Types ───

/** The 9 stage names (match the checkbox field names on ProductAggregations minus 'stage' prefix, in camelCase→snake_case) */
export type StageName =
  | 'resolve'
  | 'classify'
  | 'match_brand'
  | 'ingredients'
  | 'images'
  | 'object_detection'
  | 'embed_images'
  | 'descriptions'
  | 'score_history'

/**
 * Per-product progress map stored on the job's `aggregationProgress` JSON field.
 * Keys are product ID strings, values are the last completed stage name
 * (or null / absent if no stage has completed for that product).
 */
export type AggregationProgress = Record<string, StageName | null>

/** Job-level config passed to stages */
export interface StageConfig {
  jobId: number
  language: string
  imageSourcePriority: string[]
  /** Grounding DINO box confidence threshold (0-1). Detections below this are discarded. Default: 0.3. */
  detectionThreshold: number
  /** Minimum detection box area as a fraction (0-1) of the source image area. Default: 0.05 (5%). */
  minBoxArea: number
}

/** Context available to all stage functions */
export interface StageContext {
  payload: PayloadRestClient
  config: StageConfig
  log: Logger
  /** Uploads a local file to the media collection. Returns the media record ID. */
  uploadMedia: (filePath: string, alt: string, mimetype: string) => Promise<number>
  /** Refreshes claimedAt on the job to keep the claim alive during long operations. */
  heartbeat: () => Promise<void>
}

/** Result returned by each stage execution */
export interface StageResult {
  success: boolean
  error?: string
  /** Product ID — set by the resolve stage when it creates/finds the product. */
  productId?: number
  /** Token count from LLM calls */
  tokensUsed?: number
}

/**
 * Work item representing a product group to be processed.
 * The resolve stage receives this to create/find the product.
 * Subsequent stages use the productId from the progress map.
 */
export interface AggregationWorkItem {
  /** Product ID — set after resolve stage creates/finds the product. Null before resolve. */
  productId: number | null
  /** All GTINs in this product group */
  gtins: string[]
  /** Per-GTIN source data from source-products and source-variants */
  variants: Array<{
    gtin: string
    sources: AggregationSource[]
  }>
}

/** Stage definition */
export interface StageDefinition {
  name: StageName
  /** Index in the pipeline (0-based) — determines ordering */
  index: number
  /** The checkbox field name on the ProductAggregations job */
  jobField: string
  /** Execute the stage for a single product group */
  execute: (ctx: StageContext, workItem: AggregationWorkItem) => Promise<StageResult>
}

// ─── Stage Registry ───

import { executeResolve } from './resolve'
import { executeClassify } from './classify'
import { executeMatchBrand } from './match-brand'
import { executeIngredients } from './ingredients'
import { executeImages } from './images'
import { executeObjectDetection } from './object-detection'
import { executeEmbedImages } from './embed-images'
import { executeDescriptions } from './descriptions'
import { executeScoreHistory } from './score-history'

/** All stages in pipeline order */
export const STAGES: StageDefinition[] = [
  {
    name: 'resolve',
    index: 0,
    jobField: 'stageResolve',
    execute: executeResolve,
  },
  {
    name: 'classify',
    index: 1,
    jobField: 'stageClassify',
    execute: executeClassify,
  },
  {
    name: 'match_brand',
    index: 2,
    jobField: 'stageMatchBrand',
    execute: executeMatchBrand,
  },
  {
    name: 'ingredients',
    index: 3,
    jobField: 'stageIngredients',
    execute: executeIngredients,
  },
  {
    name: 'images',
    index: 4,
    jobField: 'stageImages',
    execute: executeImages,
  },
  {
    name: 'object_detection',
    index: 5,
    jobField: 'stageObjectDetection',
    execute: executeObjectDetection,
  },
  {
    name: 'embed_images',
    index: 6,
    jobField: 'stageEmbedImages',
    execute: executeEmbedImages,
  },
  {
    name: 'descriptions',
    index: 7,
    jobField: 'stageDescriptions',
    execute: executeDescriptions,
  },
  {
    name: 'score_history',
    index: 8,
    jobField: 'stageScoreHistory',
    execute: executeScoreHistory,
  },
]

/** Map from stage name to its index for quick lookup */
const STAGE_INDEX: Record<StageName, number> = Object.fromEntries(
  STAGES.map((s) => [s.name, s.index]),
) as Record<StageName, number>

/**
 * Get the numeric index of a stage name. Returns -1 for null/undefined
 * (meaning no stage completed yet — before the first stage).
 */
export function stageIndex(name: StageName | null | undefined): number {
  if (name == null) return -1
  return STAGE_INDEX[name] ?? -1
}

// ─── Stage Dispatch Functions ───

/**
 * Determine which stage a product needs next, given the job's enabled stages
 * and the product's last completed stage (from the job's aggregationProgress map).
 *
 * Returns the next stage definition to run, or null if the product is fully done.
 */
export function getNextStage(
  lastCompleted: StageName | null | undefined,
  enabledStages: Set<StageName>,
): StageDefinition | null {
  const currentIdx = stageIndex(lastCompleted)

  for (const stage of STAGES) {
    if (stage.index <= currentIdx) continue
    if (!enabledStages.has(stage.name)) continue
    return stage
  }

  return null
}

/**
 * Get the last enabled stage name for a job.
 */
export function getFinalStage(enabledStages: Set<StageName>): StageName | null {
  let last: StageName | null = null
  for (const stage of STAGES) {
    if (enabledStages.has(stage.name)) {
      last = stage.name
    }
  }
  return last
}

/**
 * Build the set of enabled stages from a job document.
 */
export function getEnabledStages(job: Record<string, unknown>): Set<StageName> {
  const stages = new Set<StageName>()
  if (job.stageResolve !== false) stages.add('resolve')
  if (job.stageClassify !== false) stages.add('classify')
  if (job.stageMatchBrand !== false) stages.add('match_brand')
  if (job.stageIngredients !== false) stages.add('ingredients')
  if (job.stageImages !== false) stages.add('images')
  if (job.stageObjectDetection !== false) stages.add('object_detection')
  if (job.stageEmbedImages !== false) stages.add('embed_images')
  if (job.stageDescriptions !== false) stages.add('descriptions')
  if (job.stageScoreHistory !== false) stages.add('score_history')
  return stages
}

/**
 * Check if a product needs any more work for this job's enabled stages.
 */
export function productNeedsWork(
  lastCompleted: StageName | null | undefined,
  enabledStages: Set<StageName>,
): boolean {
  return getNextStage(lastCompleted, enabledStages) !== null
}

/**
 * Read the aggregationProgress map from a job document.
 * Handles both parsed objects (from local API) and JSON strings (from REST API).
 */
export function getAggregationProgress(job: Record<string, unknown>): AggregationProgress {
  let raw = job.aggregationProgress
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as AggregationProgress
  }
  return {}
}
