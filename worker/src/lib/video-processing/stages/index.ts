/**
 * Stage-based video processing pipeline.
 *
 * Each stage reads its input from the DB (prior stage's persisted output),
 * does its work, and persists results immediately.
 *
 * Progress is tracked on the job's `videoProgress` JSON field — a map of
 * `{ [videoId]: lastCompletedStageName }`. Videos have no processing status;
 * they are pure data records. The job owns all state.
 *
 * Video download is handled by the separate video-crawl job type — the
 * processing pipeline assumes videos already have their MP4 downloaded.
 *
 * Stage ordering (by index in STAGES array):
 *   0. scene_detection      — Detect scenes, extract screenshots, cluster frames
 *   1. barcode_scan         — Scan frames for EAN barcodes → scene.barcodes[]
 *   2. object_detection     — Grounding DINO on cluster reps → scene.objects[]
 *   3. visual_search        — CLIP search on object crops → scene.recognitions[]
 *   4. llm_recognition      — LLM visual classification → scene.llmMatches[]
 *   5. transcription        — Deepgram STT + LLM correction → scene transcript
 *   6. compile_detections   — Synthesize all sources → scene.detections[]
 *   7. sentiment_analysis   — LLM sentiment → video-mentions
 */

import type { PayloadRestClient } from '@/lib/payload-client'
import type { Logger } from '@/lib/logger'

// ─── Types ───

/** The 8 stage names (match the checkbox field names on VideoProcessings minus 'stage' prefix) */
export type StageName =
  | 'scene_detection'
  | 'barcode_scan'
  | 'object_detection'
  | 'visual_search'
  | 'llm_recognition'
  | 'transcription'
  | 'compile_detections'
  | 'sentiment_analysis'

/**
 * Per-video progress map stored on the job's `videoProgress` JSON field.
 * Keys are video ID strings, values are the last completed stage name
 * (or null / absent if no stage has completed for that video).
 */
export type VideoProgress = Record<string, StageName | null>

/** Job-level config passed to stages */
export interface StageConfig {
  jobId: number
  sceneThreshold: number
  clusterThreshold: number
  transcriptionLanguage: string
  transcriptionModel: string
  /** Minimum detection box area as a fraction (0-1) of the screenshot area. Default: 0.25 (25%). */
  minBoxArea: number
  /** Grounding DINO confidence threshold (0-1). Default: 0.3. */
  detectionThreshold: number
  /** Grounding DINO text prompt for zero-shot detection. Default: "cosmetics packaging." */
  detectionPrompt: string
  /** Maximum cosine distance for CLIP similarity search (0-2). Default: 0.3. */
  searchThreshold: number
  /** Number of nearest neighbors to return per detection. Default: 1. */
  searchLimit: number
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
  /** Token counts keyed by category */
  tokens?: {
    recognition?: number
    transcriptCorrection?: number
    sentiment?: number
    total?: number
  }
}

/** Stage definition */
export interface StageDefinition {
  name: StageName
  /** Index in the pipeline (0-based) — determines ordering */
  index: number
  /** The checkbox field name on the VideoProcessings job */
  jobField: string
  /** Execute the stage for a single video */
  execute: (ctx: StageContext, videoId: number) => Promise<StageResult>
}

// ─── Stage Registry ───

// Import stage executors (lazy — each file exports a single execute function)
import { executeSceneDetection } from './scene-detection'
import { executeBarcodeScan } from './barcode-scan'
import { executeObjectDetection } from './object-detection'
import { executeVisualSearch } from './visual-search'
import { executeLlmRecognition } from './llm-recognition'
import { executeTranscription } from './transcription'
import { executeCompileDetections } from './compile-detections'
import { executeSentimentAnalysis } from './sentiment-analysis'

/** All stages in pipeline order */
export const STAGES: StageDefinition[] = [
  {
    name: 'scene_detection',
    index: 0,
    jobField: 'stageSceneDetection',
    execute: executeSceneDetection,
  },
  {
    name: 'barcode_scan',
    index: 1,
    jobField: 'stageBarcodeScan',
    execute: executeBarcodeScan,
  },
  {
    name: 'object_detection',
    index: 2,
    jobField: 'stageObjectDetection',
    execute: executeObjectDetection,
  },
  {
    name: 'visual_search',
    index: 3,
    jobField: 'stageVisualSearch',
    execute: executeVisualSearch,
  },
  {
    name: 'llm_recognition',
    index: 4,
    jobField: 'stageLlmRecognition',
    execute: executeLlmRecognition,
  },
  {
    name: 'transcription',
    index: 5,
    jobField: 'stageTranscription',
    execute: executeTranscription,
  },
  {
    name: 'compile_detections',
    index: 6,
    jobField: 'stageCompileDetections',
    execute: executeCompileDetections,
  },
  {
    name: 'sentiment_analysis',
    index: 7,
    jobField: 'stageSentimentAnalysis',
    execute: executeSentimentAnalysis,
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
 * Determine which stage a video needs next, given the job's enabled stages
 * and the video's last completed stage (from the job's videoProgress map).
 *
 * Returns the next stage definition to run, or null if the video is fully done
 * (all enabled stages after lastCompleted have been run or are disabled).
 *
 * @param lastCompleted - The last completed stage name for this video (null = none)
 * @param enabledStages - Set of enabled stage names from the job config
 */
export function getNextStage(
  lastCompleted: StageName | null | undefined,
  enabledStages: Set<StageName>,
): StageDefinition | null {
  const currentIdx = stageIndex(lastCompleted)

  for (const stage of STAGES) {
    if (stage.index <= currentIdx) continue // already completed or before
    if (!enabledStages.has(stage.name)) continue // disabled
    return stage
  }

  return null
}

/**
 * Get the last enabled stage name for a job. This is what "fully done" means
 * for a given set of enabled stages.
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
  if (job.stageSceneDetection !== false) stages.add('scene_detection')
  if (job.stageBarcodeScan !== false) stages.add('barcode_scan')
  if (job.stageObjectDetection !== false) stages.add('object_detection')
  if (job.stageVisualSearch !== false) stages.add('visual_search')
  if (job.stageLlmRecognition !== false) stages.add('llm_recognition')
  if (job.stageTranscription !== false) stages.add('transcription')
  if (job.stageCompileDetections !== false) stages.add('compile_detections')
  if (job.stageSentimentAnalysis !== false) stages.add('sentiment_analysis')
  return stages
}

/**
 * Check if a video needs any more work for this job's enabled stages.
 * Returns true if the video still has stages to run.
 *
 * @param lastCompleted - The last completed stage name for this video (from videoProgress)
 * @param enabledStages - Set of enabled stage names from the job config
 */
export function videoNeedsWork(
  lastCompleted: StageName | null | undefined,
  enabledStages: Set<StageName>,
): boolean {
  return getNextStage(lastCompleted, enabledStages) !== null
}

/**
 * Read the videoProgress map from a job document.
 * Returns a typed VideoProgress object (always an object, never null).
 * Handles both parsed objects (from local API) and JSON strings (from REST API).
 */
export function getVideoProgress(job: Record<string, unknown>): VideoProgress {
  let raw = job.videoProgress
  // Payload REST API may return json fields as strings
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as VideoProgress
  }
  return {}
}
