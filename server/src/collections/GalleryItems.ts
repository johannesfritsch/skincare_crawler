import type { CollectionConfig } from 'payload'

export const GalleryItems: CollectionConfig = {
  slug: 'gallery-items',
  labels: {
    singular: 'Gallery Item',
    plural: 'Gallery Items',
  },
  admin: {
    useAsTitle: 'gallery',
    defaultColumns: ['gallery', 'position', 'createdAt'],
    group: 'Galleries',
  },
  fields: [
    // --- Sidebar ---
    {
      name: 'gallery',
      type: 'relationship',
      relationTo: 'galleries',
      label: 'Gallery',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'position',
      type: 'number',
      label: 'Position',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
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
              name: 'image',
              type: 'upload',
              relationTo: 'gallery-media',
              label: 'Image',
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
                description: 'Barcodes found in this gallery item by zbarimg scanning. Each entry is a barcode detection with optional product resolution.',
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
                description: 'Object detection results from Grounding DINO. Each entry is a cropped region with bounding box, confidence score, and OCR text (set by ocr_extraction stage).',
              },
              fields: [
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
                // Fields set by ocr_extraction stage
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
                description: 'DINOv2 visual similarity search results. Each entry matches a detected object to a product via embedding cosine distance.',
              },
              fields: [
                {
                  name: 'object',
                  type: 'text',
                  label: 'Object ID',
                  admin: {
                    description: 'Stable ID of the detected object in this item\'s objects[] array',
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
                    description: 'DINOv2 cosine distance (lower = better, 0 = identical)',
                  },
                },
              ],
            },
          ],
        },

        // ── Detections (compile_detections — LLM-consolidated from all sources) ──
        {
          label: 'Detections',
          fields: [
            {
              name: 'detections',
              type: 'array',
              label: 'Compiled Detections',
              admin: {
                description: 'Unified product detections consolidated by LLM from all sources (barcode, visual search, OCR, caption). One entry per unique product.',
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
                    { label: 'Caption', value: 'caption' },
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

        // ── Mentions ──
        {
          label: 'Mentions',
          fields: [
            {
              name: 'galleryMentions',
              type: 'join',
              collection: 'gallery-mentions',
              on: 'galleryItem',
              admin: {
                defaultColumns: ['product', 'confidence', 'overallSentiment', 'overallSentimentScore'],
              },
            },
          ],
        },
      ],
    },
  ],
}
