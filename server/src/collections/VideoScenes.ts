import type { CollectionConfig } from 'payload'

export const VideoScenes: CollectionConfig = {
  slug: 'video-scenes',
  labels: {
    singular: 'Video Scene',
    plural: 'Video Scenes',
  },
  admin: {
    useAsTitle: 'video',
    defaultColumns: ['video', 'timestampStart', 'timestampEnd', 'createdAt'],
    group: 'Videos',
    hidden: true,
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'video-mentions',
          where: { videoScene: { equals: id } },
          req,
        })
        await req.payload.delete({
          collection: 'video-frames',
          where: { scene: { equals: id } },
          req,
        })
      },
    ],
  },
  fields: [
    // --- Sidebar ---
    {
      name: 'timestampStart',
      type: 'number',
      label: 'Timestamp Start',
      admin: {
        position: 'sidebar',
        description: 'Start time in seconds',
      },
    },
    {
      name: 'timestampEnd',
      type: 'number',
      label: 'Timestamp End',
      admin: {
        position: 'sidebar',
        description: 'End time in seconds',
      },
    },
    // --- Tabs ---
    {
      type: 'tabs',
      tabs: [
        // ── General ──
        {
          label: 'General',
          fields: [
            {
              name: 'embeddedPlayer',
              type: 'ui',
              admin: {
                components: {
                  Field: '/components/EmbeddedScenePlayer',
                },
              },
            },
            {
              name: 'video',
              type: 'relationship',
              relationTo: 'videos',
              label: 'Video',
              required: true,
            },
            {
              name: 'image',
              type: 'upload',
              relationTo: 'video-media',
              label: 'Image',
            },
          ],
        },

        // ── Frames (Stage 0: scene_detection) ──
        {
          label: 'Frames',
          fields: [
            {
              name: 'frames',
              type: 'join',
              collection: 'video-frames',
              on: 'scene',
              defaultLimit: 100,
              admin: {
                components: {
                  Field: '/components/FramesGallery',
                },
              },
            },
          ],
        },

        // ── Barcodes (Stage 1: barcode_scan) ──
        {
          label: 'Barcodes',
          fields: [
            {
              name: 'barcodes',
              type: 'array',
              label: 'Barcodes',
              admin: {
                description: 'Barcodes found in this scene by zbarimg scanning. Each entry is a barcode detection with optional product resolution.',
              },
              fields: [
                {
                  name: 'barcode',
                  type: 'text',
                  label: 'Barcode',
                  required: true,
                  admin: { description: 'EAN-13/EAN-8 barcode value' },
                },
                {
                  name: 'frame',
                  type: 'relationship',
                  relationTo: 'video-frames',
                  label: 'Frame',
                  admin: {
                    description: 'The frame where this barcode was detected',
                    components: {
                      Field: '@/components/DetectionFrameField',
                    },
                  },
                },
                {
                  name: 'productVariant',
                  type: 'relationship',
                  relationTo: 'product-variants',
                  label: 'Product Variant',
                  admin: { description: 'Resolved product-variant by GTIN lookup' },
                },
                {
                  name: 'product',
                  type: 'relationship',
                  relationTo: 'products',
                  label: 'Product',
                  admin: { description: 'Resolved product from the product-variant' },
                },
              ],
            },
          ],
        },

        // ── Objects (Stage 2: object_detection + Stage 3: side_detection) ──
        {
          label: 'Objects',
          fields: [
            {
              name: 'objects',
              type: 'array',
              label: 'Detected Objects',
              admin: {
                description: 'Object detection results from Grounding DINO. Each entry is a cropped region from a frame with bounding box, confidence score, and side classification (set by side_detection stage).',
              },
              fields: [
                {
                  name: 'frame',
                  type: 'relationship',
                  relationTo: 'video-frames',
                  label: 'Source Frame',
                  admin: {
                    components: {
                      Field: '@/components/DetectionFrameField',
                    },
                  },
                },
                {
                  name: 'crop',
                  type: 'upload',
                  relationTo: 'detection-media',
                  label: 'Detection Crop',
                  required: true,
                },
                {
                  name: 'score',
                  type: 'number',
                  label: 'Detection Score',
                  min: 0,
                  max: 1,
                  admin: {
                    step: 0.001,
                    description: 'Grounding DINO detection confidence (0-1)',
                  },
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'boxXMin', type: 'number', label: 'X Min', admin: { width: '25%' } },
                    { name: 'boxYMin', type: 'number', label: 'Y Min', admin: { width: '25%' } },
                    { name: 'boxXMax', type: 'number', label: 'X Max', admin: { width: '25%' } },
                    { name: 'boxYMax', type: 'number', label: 'Y Max', admin: { width: '25%' } },
                  ],
                },
                // Fields set by side_detection stage (stage 3)
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'side',
                      type: 'select',
                      label: 'Side',
                      options: [
                        { label: 'Front', value: 'front' },
                        { label: 'Back', value: 'back' },
                        { label: 'Unknown', value: 'unknown' },
                      ],
                      admin: {
                        width: '33%',
                        description: 'Packaging side classification (set by side_detection stage)',
                      },
                    },
                    {
                      name: 'clusterGroup',
                      type: 'number',
                      label: 'Cluster Group',
                      admin: {
                        width: '33%',
                        description: 'Cluster index within same-side crops (set by side_detection stage)',
                      },
                    },
                    {
                      name: 'isRepresentative',
                      type: 'checkbox',
                      label: 'Representative',
                      admin: {
                        width: '33%',
                        description: 'Whether this crop is the representative for its side-cluster (set by side_detection stage)',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },

        // ── Recognitions (Stage 3: visual_search) ──
        {
          label: 'Recognitions',
          fields: [
            {
              name: 'recognitions',
              type: 'array',
              label: 'Visual Recognitions',
              admin: {
                description: 'CLIP visual similarity search results. Each entry matches a detected object to a product via embedding cosine distance.',
              },
              fields: [
                {
                  name: 'objectIndex',
                  type: 'number',
                  label: 'Object Index',
                  admin: { description: 'Index into the objects[] array on this scene' },
                },
                {
                  name: 'product',
                  type: 'relationship',
                  relationTo: 'products',
                  label: 'Matched Product',
                },
                {
                  name: 'productVariant',
                  type: 'relationship',
                  relationTo: 'product-variants',
                  label: 'Matched Variant',
                },
                {
                  name: 'gtin',
                  type: 'text',
                  label: 'Matched GTIN',
                  admin: { description: 'GTIN of the matched product-variant' },
                },
                {
                  name: 'distance',
                  type: 'number',
                  label: 'Cosine Distance',
                  admin: {
                    step: 0.0001,
                    description: 'CLIP cosine distance (lower = better, 0 = identical)',
                  },
                },
              ],
            },
          ],
        },

        // ── LLM Matches (Stage 4: llm_recognition) ──
        {
          label: 'LLM Matches',
          fields: [
            {
              name: 'llmMatches',
              type: 'array',
              label: 'LLM Matches',
              admin: {
                description: 'Products identified by LLM visual recognition. The LLM classifies screenshots and extracts brand/product info.',
              },
              fields: [
                {
                  name: 'frame',
                  type: 'relationship',
                  relationTo: 'video-frames',
                  label: 'Source Frame',
                  admin: {
                    components: {
                      Field: '@/components/DetectionFrameField',
                    },
                  },
                },
                {
                  name: 'brand',
                  type: 'text',
                  label: 'Brand',
                  admin: { description: 'Brand name identified by the LLM' },
                },
                {
                  name: 'productName',
                  type: 'text',
                  label: 'Product Name',
                  admin: { description: 'Product name identified by the LLM' },
                },
                {
                  name: 'searchTerms',
                  type: 'json',
                  label: 'Search Terms',
                  admin: { description: 'Search terms extracted by the LLM for product matching' },
                },
                {
                  name: 'product',
                  type: 'relationship',
                  relationTo: 'products',
                  label: 'Matched Product',
                  admin: { description: 'Product found/created via LLM + DB matching' },
                },
              ],
            },
          ],
        },

        // ── Transcription (Stage 5: transcription) ──
        {
          label: 'Transcription',
          fields: [
            {
              name: 'transcript',
              type: 'textarea',
              label: 'Transcript',
              admin: {
                description: 'Transcribed spoken words for this scene (from per-scene Whisper transcription)',
              },
            },
          ],
        },

        // ── Detections (Stage 6: compile_detections — synthesized from all sources) ──
        {
          label: 'Detections',
          fields: [
            {
              name: 'detections',
              type: 'array',
              label: 'Compiled Detections',
              admin: {
                description: 'Unified product detections synthesized from all sources (barcode, object detection + CLIP, LLM vision). One entry per unique product.',
              },
              fields: [
                {
                  name: 'product',
                  type: 'relationship',
                  relationTo: 'products',
                  label: 'Product',
                  required: true,
                },
                {
                  name: 'confidence',
                  type: 'number',
                  label: 'Confidence',
                  min: 0,
                  max: 1,
                  admin: {
                    step: 0.01,
                    description: 'Synthesized confidence score (0-1) combining all detection sources',
                  },
                },
                {
                  name: 'sources',
                  type: 'select',
                  hasMany: true,
                  label: 'Sources',
                  options: [
                    { label: 'Barcode', value: 'barcode' },
                    { label: 'Object Detection', value: 'object_detection' },
                    { label: 'Vision LLM', value: 'vision_llm' },
                  ],
                  admin: { description: 'Which detection methods identified this product' },
                },
                {
                  name: 'barcodeValue',
                  type: 'text',
                  label: 'Barcode Value',
                  admin: { description: 'EAN barcode if detected via barcode source' },
                },
                {
                  name: 'clipDistance',
                  type: 'number',
                  label: 'CLIP Distance',
                  admin: {
                    step: 0.0001,
                    description: 'Best CLIP cosine distance if detected via object detection',
                  },
                },
                {
                  name: 'llmBrand',
                  type: 'text',
                  label: 'LLM Brand',
                  admin: { description: 'Brand name from LLM recognition' },
                },
                {
                  name: 'llmProductName',
                  type: 'text',
                  label: 'LLM Product Name',
                  admin: { description: 'Product name from LLM recognition' },
                },
              ],
            },
          ],
        },

        // ── Mentions (Stage 7: sentiment_analysis — final output) ──
        {
          label: 'Mentions',
          fields: [
            {
              name: 'videoMentions',
              type: 'join',
              collection: 'video-mentions',
              on: 'videoScene',
              admin: {
                defaultColumns: ['product', 'confidence', 'overallSentiment', 'overallSentimentScore'],
                components: {
                  Cell: '/components/VideoMentionsCell',
                },
              },
            },
          ],
        },
      ],
    },
  ],
}
