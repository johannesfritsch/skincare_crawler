/**
 * DINOv2-base image embedding singleton.
 *
 * Model: Xenova/dinov2-base (~300MB, cached in .cache/huggingface)
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * Lazy-loaded on first call, reused across all subsequent invocations.
 *
 * Output: 768-dimensional embedding vectors (image-feature-extraction pipeline).
 */

const MODEL_ID = 'Xenova/dinov2-base'

export const EMBEDDING_DIMENSIONS = 768

// Lazy-loaded pipeline singleton — created once per worker process
let extractorPromise: Promise<FeatureExtractor> | null = null

export interface FeatureExtractor {
  (images: string | string[], options?: { pool?: boolean | null }): Promise<{
    data: Float32Array
    dims: number[]
  }>
}

export async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Dynamic import — @huggingface/transformers is ESM
      const { pipeline, env } = await import('@huggingface/transformers')

      // Prefer local cache dir for models
      env.cacheDir = './.cache/huggingface'

      const extractor = await pipeline('image-feature-extraction', MODEL_ID, {
        dtype: 'fp32',
      })
      return extractor as unknown as FeatureExtractor
    })()
  }
  return extractorPromise
}

/**
 * Compute a DINOv2 embedding for an image URL and return the L2-normalized 768-dim vector.
 */
export async function computeImageEmbedding(imageUrl: string): Promise<number[] | null> {
  const extractor = await getExtractor()
  const output = await extractor(imageUrl)

  const raw = output.data.slice(0, EMBEDDING_DIMENSIONS)
  if (raw.length !== EMBEDDING_DIMENSIONS) return null

  // L2-normalize for cosine similarity via pgvector's <=> operator
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0))
  return norm > 0 ? Array.from(raw, (v) => v / norm) : Array.from(raw)
}

/**
 * Compute a DINOv2 embedding from a raw image buffer (PNG/JPEG).
 * Uses RawImage from @huggingface/transformers to avoid base64 data URL overhead.
 */
export async function computeImageEmbeddingFromBuffer(buffer: Buffer): Promise<number[] | null> {
  const { RawImage } = await import('@huggingface/transformers')
  const image = await RawImage.fromBlob(new Blob([buffer]))

  const extractor = await getExtractor()
  const output = await (extractor as Function)(image)

  const raw = output.data.slice(0, EMBEDDING_DIMENSIONS)
  if (raw.length !== EMBEDDING_DIMENSIONS) return null

  // L2-normalize for cosine similarity via pgvector's <=> operator
  const norm = Math.sqrt(raw.reduce((sum: number, v: number) => sum + v * v, 0))
  return norm > 0 ? Array.from(raw, (v: number) => v / norm) : Array.from(raw)
}

/**
 * @deprecated Use computeImageEmbedding instead. Kept for backward compatibility.
 */
export const computeClipEmbedding = computeImageEmbedding
