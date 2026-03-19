/**
 * Stage-based video crawl pipeline.
 *
 * Three stages:
 *   0. metadata  — yt-dlp --dump-json, resolve/create channel + creator, download thumbnail,
 *                  create/update video record (without videoFile/audioFile).
 *   1. download  — yt-dlp download MP4, upload to video-media, update video.videoFile + duration.
 *   2. audio     — download videoFile, extract audio via ffmpeg, upload WAV, update video.audioFile,
 *                  set status='crawled'.
 *
 * Progress is tracked on the job's `crawlProgress` JSON field — a map of
 * `{ [videoKey]: lastCompletedStageName }`. Keys are either the numeric videoId (string)
 * for known DB records, or `url:<externalUrl>` for new videos without DB records.
 * After metadata creates a DB record, the videoId is stored at `vid:<urlKey>` for lookup.
 */

import type { PayloadRestClient } from '@/lib/payload-client'
import type { Logger } from '@/lib/logger'

// ─── Types ───

/** The 3 crawl stage names */
export type VideoCrawlStageName = 'metadata' | 'download' | 'audio'

/**
 * Per-video progress map stored on the job's `crawlProgress` JSON field.
 * Keys are video ID strings or `url:<externalUrl>` for new videos.
 * Error counts stored as `err:<key>` → count string.
 * videoId lookup stored as `vid:<urlKey>` → videoId string (set after metadata stage).
 */
export type VideoCrawlProgress = Record<string, VideoCrawlStageName | null>

/** Stage definition */
export interface VideoCrawlStageDefinition {
  name: VideoCrawlStageName
  /** Index in the pipeline (0-based) — determines ordering */
  index: number
  /** The checkbox field name on the VideoCrawls job */
  jobField: string
}

// ─── Stage Registry ───

/** All stages in pipeline order */
export const VIDEO_CRAWL_STAGES: VideoCrawlStageDefinition[] = [
  {
    name: 'metadata',
    index: 0,
    jobField: 'stageMetadata',
  },
  {
    name: 'download',
    index: 1,
    jobField: 'stageDownload',
  },
  {
    name: 'audio',
    index: 2,
    jobField: 'stageAudio',
  },
]

/** Map from stage name to its index for quick lookup */
const STAGE_INDEX: Record<VideoCrawlStageName, number> = Object.fromEntries(
  VIDEO_CRAWL_STAGES.map((s) => [s.name, s.index]),
) as Record<VideoCrawlStageName, number>

/**
 * Get the numeric index of a stage name. Returns -1 for null/undefined
 * (meaning no stage completed yet — before the first stage).
 */
export function videoCrawlStageIndex(name: VideoCrawlStageName | null | undefined): number {
  if (name == null) return -1
  return STAGE_INDEX[name] ?? -1
}

// ─── Stage Dispatch Functions ───

/**
 * Determine which stage a video needs next, given the job's enabled stages
 * and the video's last completed stage (from the crawlProgress map).
 */
export function getNextVideoCrawlStage(
  lastCompleted: VideoCrawlStageName | null | undefined,
  enabledStages: Set<VideoCrawlStageName>,
): VideoCrawlStageDefinition | null {
  const currentIdx = videoCrawlStageIndex(lastCompleted)

  for (const stage of VIDEO_CRAWL_STAGES) {
    if (stage.index <= currentIdx) continue
    if (!enabledStages.has(stage.name)) continue
    return stage
  }

  return null
}

/**
 * Get the last enabled stage name for a job.
 */
export function getFinalVideoCrawlStage(enabledStages: Set<VideoCrawlStageName>): VideoCrawlStageName | null {
  let last: VideoCrawlStageName | null = null
  for (const stage of VIDEO_CRAWL_STAGES) {
    if (enabledStages.has(stage.name)) {
      last = stage.name
    }
  }
  return last
}

/**
 * Build the set of enabled stages from a job document.
 */
export function getEnabledVideoCrawlStages(job: Record<string, unknown>): Set<VideoCrawlStageName> {
  const stages = new Set<VideoCrawlStageName>()
  if (job.stageMetadata !== false) stages.add('metadata')
  if (job.stageDownload !== false) stages.add('download')
  if (job.stageAudio !== false) stages.add('audio')
  return stages
}

/**
 * Check if a video needs any more work for this job's enabled stages.
 * Returns false if the video has been marked as permanently failed.
 */
export function videoNeedsCrawlWork(
  lastCompleted: VideoCrawlStageName | null | undefined,
  enabledStages: Set<VideoCrawlStageName>,
): boolean {
  if (lastCompleted === '!failed' as VideoCrawlStageName) return false
  return getNextVideoCrawlStage(lastCompleted, enabledStages) !== null
}

/** Sentinel value stored in progress when a video has permanently failed */
export const VIDEO_CRAWL_FAILED_SENTINEL = '!failed'

/**
 * Get the per-video error count from the progress map.
 */
export function getVideoErrorCount(progress: VideoCrawlProgress, videoKey: string): number {
  const key = `err:${videoKey}`
  const val = progress[key]
  return typeof val === 'string' ? parseInt(val, 10) || 0 : 0
}

/**
 * Increment the per-video error count in the progress map.
 */
export function incrementVideoErrorCount(progress: VideoCrawlProgress, videoKey: string): number {
  const key = `err:${videoKey}`
  const current = getVideoErrorCount(progress, videoKey)
  const next = current + 1
  progress[key] = String(next) as VideoCrawlStageName
  return next
}

/**
 * Mark a video as permanently failed in the progress map.
 */
export function markVideoCrawlFailed(progress: VideoCrawlProgress, videoKey: string): void {
  progress[videoKey] = VIDEO_CRAWL_FAILED_SENTINEL as VideoCrawlStageName
}

/**
 * Get the progress key for a video item. Uses the videoId (string) if known,
 * otherwise `url:<externalUrl>`.
 */
export function getVideoCrawlProgressKey(videoId: number | undefined, externalUrl: string): string {
  return videoId != null ? String(videoId) : `url:${externalUrl}`
}

/**
 * Read the crawlProgress map from a job document.
 * Handles both parsed objects (from local API) and JSON strings (from REST API).
 */
export function getVideoCrawlProgress(job: Record<string, unknown>): VideoCrawlProgress {
  let raw = job.crawlProgress
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as VideoCrawlProgress
  }
  return {}
}

// ─── Context & Result Types ───

/** Context available to all video crawl stage functions */
export interface VideoCrawlStageContext {
  payload: PayloadRestClient
  config: { jobId: number }
  log: Logger
  /** Uploads a local file to the media collection. Returns the media record ID. */
  uploadMedia: (filePath: string, alt: string, mimetype: string, collection?: string) => Promise<number>
  /** Refreshes claimedAt on the job to keep the claim alive during long operations. */
  heartbeat: () => Promise<void>
}

/** A single work item passed to a stage */
export interface VideoCrawlWorkItem {
  videoId?: number
  externalUrl: string
  title: string
}

/** Result returned by each stage execution */
export interface VideoCrawlStageResult {
  success: boolean
  error?: string
  /** Set when the metadata stage creates a new video record */
  videoId?: number
}
