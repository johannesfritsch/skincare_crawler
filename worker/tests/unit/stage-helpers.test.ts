/**
 * Unit tests for stage advancement helpers across all job types.
 *
 * Tests the pure functions that drive multi-stage work item progression:
 *   - video-crawl: 3 stages (metadata → download → audio)
 *   - product-aggregation: 11 stages (resolve → ... → sentiment_conclusion)
 *   - Enabled/disabled stage combinations
 *   - Failed product/video sentinels
 */

import { describe, test, expect, vi } from 'vitest'

// Mock heavy transitive dependencies to avoid circular import issues
vi.mock('@/lib/source-discovery/driver', () => ({
  getAllSourceDrivers: () => [],
  getSourceDriver: () => null,
  getSourceDriverBySlug: () => null,
  ALL_SOURCE_SLUGS: [],
  DEFAULT_IMAGE_SOURCE_PRIORITY: [],
  DEFAULT_BRAND_SOURCE_PRIORITY: [],
}))

// ─── Video Crawl Stages ───

import {
  getNextVideoCrawlStage,
  getEnabledVideoCrawlStages,
  getFinalVideoCrawlStage,
  videoNeedsCrawlWork,
  getVideoCrawlProgressKey,
  type VideoCrawlStageName,
} from '@/lib/video-crawl/stages'

describe('Video crawl stage advancement', () => {
  test('null → metadata when all enabled', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    const next = getNextVideoCrawlStage(null, enabled)
    expect(next?.name).toBe('metadata')
  })

  test('metadata → download', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    const next = getNextVideoCrawlStage('metadata', enabled)
    expect(next?.name).toBe('download')
  })

  test('download → audio', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    const next = getNextVideoCrawlStage('download', enabled)
    expect(next?.name).toBe('audio')
  })

  test('audio → null (end of pipeline)', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    const next = getNextVideoCrawlStage('audio', enabled)
    expect(next).toBeNull()
  })

  test('skips disabled stages: metadata → audio when download disabled', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'audio'])
    const next = getNextVideoCrawlStage('metadata', enabled)
    expect(next?.name).toBe('audio')
  })

  test('null → download when only download+audio enabled', () => {
    const enabled = new Set<VideoCrawlStageName>(['download', 'audio'])
    const next = getNextVideoCrawlStage(null, enabled)
    expect(next?.name).toBe('download')
  })

  test('metadata only → null after metadata', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata'])
    const next = getNextVideoCrawlStage('metadata', enabled)
    expect(next).toBeNull()
  })
})

describe('getEnabledVideoCrawlStages', () => {
  test('all enabled by default', () => {
    const stages = getEnabledVideoCrawlStages({})
    expect(stages.has('metadata')).toBe(true)
    expect(stages.has('download')).toBe(true)
    expect(stages.has('audio')).toBe(true)
  })

  test('respects stageMetadata=false', () => {
    const stages = getEnabledVideoCrawlStages({ stageMetadata: false })
    expect(stages.has('metadata')).toBe(false)
    expect(stages.has('download')).toBe(true)
    expect(stages.has('audio')).toBe(true)
  })

  test('respects stageDownload=false', () => {
    const stages = getEnabledVideoCrawlStages({ stageDownload: false })
    expect(stages.has('metadata')).toBe(true)
    expect(stages.has('download')).toBe(false)
    expect(stages.has('audio')).toBe(true)
  })

  test('respects stageAudio=false', () => {
    const stages = getEnabledVideoCrawlStages({ stageAudio: false })
    expect(stages.has('metadata')).toBe(true)
    expect(stages.has('download')).toBe(true)
    expect(stages.has('audio')).toBe(false)
  })
})

describe('getFinalVideoCrawlStage', () => {
  test('audio is final when all enabled', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    expect(getFinalVideoCrawlStage(enabled)).toBe('audio')
  })

  test('download is final when audio disabled', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download'])
    expect(getFinalVideoCrawlStage(enabled)).toBe('download')
  })

  test('metadata is final when only metadata enabled', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata'])
    expect(getFinalVideoCrawlStage(enabled)).toBe('metadata')
  })

  test('null when nothing enabled', () => {
    const enabled = new Set<VideoCrawlStageName>()
    expect(getFinalVideoCrawlStage(enabled)).toBeNull()
  })
})

describe('videoNeedsCrawlWork', () => {
  test('needs work when no stage completed', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    expect(videoNeedsCrawlWork(null, enabled)).toBe(true)
  })

  test('needs work after metadata', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    expect(videoNeedsCrawlWork('metadata', enabled)).toBe(true)
  })

  test('no work after audio (final stage)', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    expect(videoNeedsCrawlWork('audio', enabled)).toBe(false)
  })

  test('no work for failed videos', () => {
    const enabled = new Set<VideoCrawlStageName>(['metadata', 'download', 'audio'])
    expect(videoNeedsCrawlWork('!failed' as VideoCrawlStageName, enabled)).toBe(false)
  })
})

describe('getVideoCrawlProgressKey', () => {
  test('uses videoId when available', () => {
    expect(getVideoCrawlProgressKey(42, 'https://youtube.com/watch?v=abc')).toBe('42')
  })

  test('uses url: prefix when no videoId', () => {
    const url = 'https://youtube.com/watch?v=abc'
    expect(getVideoCrawlProgressKey(undefined, url)).toBe(`url:${url}`)
  })
})

// ─── Product Aggregation Stages ───

import {
  getNextStage as getNextAggregationStage,
  getEnabledStages as getEnabledAggregationStages,
  getFinalStage as getFinalAggregationStage,
  productNeedsWork,
  type StageName as AggregationStageName,
} from '@/lib/product-aggregation/stages'

describe('Product aggregation stage advancement', () => {
  const allStages: AggregationStageName[] = [
    'resolve', 'classify', 'match_brand', 'ingredients', 'images',
    'object_detection', 'embed_images', 'descriptions', 'score_history',
    'review_sentiment', 'sentiment_conclusion',
  ]

  test('null → resolve when all enabled', () => {
    const enabled = new Set<AggregationStageName>(allStages)
    const next = getNextAggregationStage(null, enabled)
    expect(next?.name).toBe('resolve')
  })

  test('walks through all 11 stages in order', () => {
    const enabled = new Set<AggregationStageName>(allStages)
    let current: AggregationStageName | null = null
    const visited: string[] = []

    while (true) {
      const next = getNextAggregationStage(current, enabled)
      if (!next) break
      visited.push(next.name)
      current = next.name
    }

    expect(visited).toEqual(allStages)
  })

  test('skips disabled stages', () => {
    const enabled = new Set<AggregationStageName>(['resolve', 'images', 'descriptions'])
    const next1 = getNextAggregationStage(null, enabled)
    expect(next1?.name).toBe('resolve')

    const next2 = getNextAggregationStage('resolve', enabled)
    expect(next2?.name).toBe('images')

    const next3 = getNextAggregationStage('images', enabled)
    expect(next3?.name).toBe('descriptions')

    const next4 = getNextAggregationStage('descriptions', enabled)
    expect(next4).toBeNull()
  })

  test('sentiment_conclusion → null (end of pipeline)', () => {
    const enabled = new Set<AggregationStageName>(allStages)
    const next = getNextAggregationStage('sentiment_conclusion', enabled)
    expect(next).toBeNull()
  })
})

describe('getEnabledAggregationStages', () => {
  test('all enabled by default', () => {
    const stages = getEnabledAggregationStages({})
    expect(stages.size).toBe(11)
    expect(stages.has('resolve')).toBe(true)
    expect(stages.has('sentiment_conclusion')).toBe(true)
  })

  test('respects individual stage disabling', () => {
    const stages = getEnabledAggregationStages({ stageClassify: false, stageImages: false })
    expect(stages.has('resolve')).toBe(true)
    expect(stages.has('classify')).toBe(false)
    expect(stages.has('images')).toBe(false)
    expect(stages.has('descriptions')).toBe(true)
    expect(stages.size).toBe(9)
  })
})

describe('getFinalAggregationStage', () => {
  test('sentiment_conclusion is final when all enabled', () => {
    const allStages: AggregationStageName[] = [
      'resolve', 'classify', 'match_brand', 'ingredients', 'images',
      'object_detection', 'embed_images', 'descriptions', 'score_history',
      'review_sentiment', 'sentiment_conclusion',
    ]
    expect(getFinalAggregationStage(new Set(allStages))).toBe('sentiment_conclusion')
  })

  test('resolve is final when only resolve enabled', () => {
    expect(getFinalAggregationStage(new Set<AggregationStageName>(['resolve']))).toBe('resolve')
  })
})

describe('productNeedsWork', () => {
  const allStages = new Set<AggregationStageName>([
    'resolve', 'classify', 'match_brand', 'ingredients', 'images',
    'object_detection', 'embed_images', 'descriptions', 'score_history',
    'review_sentiment', 'sentiment_conclusion',
  ])

  test('needs work when no stage completed', () => {
    expect(productNeedsWork(null, allStages)).toBe(true)
  })

  test('needs work after resolve', () => {
    expect(productNeedsWork('resolve', allStages)).toBe(true)
  })

  test('no work after sentiment_conclusion', () => {
    expect(productNeedsWork('sentiment_conclusion', allStages)).toBe(false)
  })

  test('no work for failed products', () => {
    expect(productNeedsWork('!failed' as AggregationStageName, allStages)).toBe(false)
  })
})
