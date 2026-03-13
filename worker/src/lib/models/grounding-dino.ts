/**
 * Grounding DINO singleton — shared across all stages that need object detection.
 *
 * Model: onnx-community/grounding-dino-tiny-ONNX (~700MB, cached in .cache/huggingface)
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * Lazy-loaded on first call, reused across all subsequent invocations.
 */

const MODEL_ID = 'onnx-community/grounding-dino-tiny-ONNX'

// Lazy-loaded pipeline singleton — created once per worker process
let detectorPromise: Promise<ObjectDetectionPipeline> | null = null

export interface DetectionResult {
  score: number
  label: string
  box: { xmin: number; ymin: number; xmax: number; ymax: number }
}

export interface ObjectDetectionPipeline {
  (image: unknown, labels: string[], options?: { threshold?: number }): Promise<DetectionResult[]>
}

export async function getDetector(): Promise<ObjectDetectionPipeline> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // Dynamic import — @huggingface/transformers is ESM
      const { pipeline, env } = await import('@huggingface/transformers')

      // Prefer local cache dir for models
      env.cacheDir = './.cache/huggingface'

      const detector = await pipeline('zero-shot-object-detection', MODEL_ID, {
        dtype: 'fp32',
      })
      return detector as unknown as ObjectDetectionPipeline
    })()
  }
  return detectorPromise
}
