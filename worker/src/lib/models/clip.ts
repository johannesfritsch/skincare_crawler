/**
 * CLIP ViT-B/32 singleton — shared across all stages that need image embeddings.
 *
 * Model: Xenova/clip-vit-base-patch32 (~350MB, cached in .cache/huggingface)
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * Lazy-loaded on first call, reused across all subsequent invocations.
 *
 * Output: 512-dimensional embedding vectors (image-feature-extraction pipeline).
 */

const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32'

export const EMBEDDING_DIMENSIONS = 512

// Lazy-loaded pipeline singleton — created once per worker process
let extractorPromise: Promise<CLIPFeatureExtractor> | null = null

export interface CLIPFeatureExtractor {
  (images: string | string[], options?: { pool?: boolean | null }): Promise<{
    data: Float32Array
    dims: number[]
  }>
}

export async function getExtractor(): Promise<CLIPFeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Dynamic import — @huggingface/transformers is ESM
      const { pipeline, env } = await import('@huggingface/transformers')

      // Prefer local cache dir for models
      env.cacheDir = './.cache/huggingface'

      const extractor = await pipeline('image-feature-extraction', CLIP_MODEL_ID, {
        dtype: 'fp32',
      })
      return extractor as unknown as CLIPFeatureExtractor
    })()
  }
  return extractorPromise
}

/**
 * Compute a CLIP embedding for an image URL and return the L2-normalized 512-dim vector.
 */
export async function computeClipEmbedding(imageUrl: string): Promise<number[] | null> {
  const extractor = await getExtractor()
  const output = await extractor(imageUrl)

  const raw = output.data.slice(0, EMBEDDING_DIMENSIONS)
  if (raw.length !== EMBEDDING_DIMENSIONS) return null

  // L2-normalize for cosine similarity via pgvector's <=> operator
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0))
  return norm > 0 ? Array.from(raw, (v) => v / norm) : Array.from(raw)
}
