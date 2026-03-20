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

        // ── Objects (Stage 2: object_detection + Stage 4: ocr_extraction) ──
        {
          label: 'Objects',
          fields: [
            {
              name: 'objects',
              type: 'array',
              label: 'Detected Objects',
              admin: {
                description: 'Object detection results from Grounding DINO. Each entry is a cropped region from a frame with bounding box, confidence score, and OCR text (set by ocr_extraction stage).',
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
                // Fields set by ocr_extraction stage (stage 4)
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'ocrBrand',
                      type: 'text',
                      label: 'OCR Brand',
                      admin: {
                        width: '33%',
                        description: 'Brand name read from packaging via OCR (set by ocr_extraction stage)',
                      },
                    },
                    {
                      name: 'ocrProductName',
                      type: 'text',
                      label: 'OCR Product Name',
                      admin: {
                        width: '33%',
                        description: 'Product name read from packaging via OCR (set by ocr_extraction stage)',
                      },
                    },
                    {
                      name: 'ocrText',
                      type: 'textarea',
                      label: 'OCR Text',
                      admin: {
                        width: '33%',
                        description: 'All visible text read from packaging via OCR (set by ocr_extraction stage)',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },

        // ── Recognitions (Stage 3: visual_search — multi-candidate) ──
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
                  name: 'object',
                  type: 'text',
                  label: 'Object ID',
                  admin: {
                    description: 'Stable ID of the detected object in this scene\'s objects[] array',
                    components: {
                      Field: '@/components/RecognitionObjectField',
                    },
                  },
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

        // ── LLM Matches (Stage 5: llm_recognition) ──
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
              name: 'preTranscript',
              type: 'textarea',
              label: 'Pre-Transcript',
              admin: {
                description: 'Last sentence from the previous scene — provides context for LLM stages.',
              },
            },
            {
              name: 'transcript',
              type: 'textarea',
              label: 'Transcript',
              admin: {
                description: 'Transcribed spoken words for this scene.',
              },
            },
            {
              name: 'postTranscript',
              type: 'textarea',
              label: 'Post-Transcript',
              admin: {
                description: 'First sentence from the next scene — provides context for LLM stages.',
              },
            },
          ],
        },

        // ── Detections (Stage 7: compile_detections — LLM-consolidated from all sources) ──
        {
          label: 'Detections',
          fields: [
            {
              name: 'detections',
              type: 'array',
              label: 'Compiled Detections',
              admin: {
                description: 'Unified product detections consolidated by LLM from all sources (barcode, visual search, OCR, LLM vision, transcript). One entry per unique product.',
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
                    description: 'Confidence score (0-1). Barcode matches = 1.0, others assigned by LLM consolidation.',
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
                    { label: 'OCR', value: 'ocr' },
                    { label: 'Transcript', value: 'transcript' },
                  ],
                  admin: { description: 'Which detection methods contributed evidence for this product' },
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
                    description: 'Best DINOv2 cosine distance if detected via visual search',
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
                {
                  name: 'reasoning',
                  type: 'textarea',
                  label: 'Reasoning',
                  admin: { description: 'LLM consolidation reasoning for this detection (not set for barcode matches)' },
                },
              ],
            },
          ],
        },

        // ── Mentions (Stage 8: sentiment_analysis — final output) ──
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
