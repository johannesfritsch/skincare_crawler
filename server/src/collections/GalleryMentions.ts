import type { CollectionConfig } from 'payload'

export const GalleryMentions: CollectionConfig = {
  slug: 'gallery-mentions',
  labels: {
    singular: 'Gallery Mention',
    plural: 'Gallery Mentions',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['product', 'confidence', 'overallSentiment', 'overallSentimentScore'],
    group: 'Galleries',
  },
  fields: [
    {
      name: 'galleryItem',
      type: 'relationship',
      relationTo: 'gallery-items',
      label: 'Gallery Item',
      required: true,
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'gallery',
      type: 'relationship',
      relationTo: 'galleries',
      label: 'Gallery',
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      label: 'Product',
      required: true,
      index: true,
      admin: { position: 'sidebar' },
    },

    // ── Detection provenance (copied from compiled detections) ──
    {
      name: 'confidence',
      type: 'number',
      label: 'Confidence',
      min: 0,
      max: 1,
      admin: {
        position: 'sidebar',
        step: 0.01,
        description: 'Synthesized detection confidence (0-1)',
      },
    },
    {
      name: 'sources',
      type: 'select',
      hasMany: true,
      label: 'Detection Sources',
      options: [
        { label: 'Barcode', value: 'barcode' },
        { label: 'Object Detection', value: 'object_detection' },
        { label: 'Vision LLM', value: 'vision_llm' },
        { label: 'OCR', value: 'ocr' },
        { label: 'Caption', value: 'caption' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Which detection methods contributed evidence for this product',
      },
    },
    {
      name: 'barcodeValue',
      type: 'text',
      label: 'Barcode Value',
      admin: {
        description: 'EAN barcode if detected via barcode source',
      },
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

    // ── Sentiment (from LLM analysis) ──
    {
      name: 'quotes',
      type: 'array',
      label: 'Quotes',
      admin: {
        description: 'Quotes about this product extracted from the gallery caption',
      },
      fields: [
        {
          name: 'text',
          type: 'textarea',
          label: 'Quote Text',
          required: true,
        },
        {
          name: 'summary',
          type: 'array',
          label: 'Summary',
          admin: {
            description: 'Short key takeaways from the quote, true to original wording',
          },
          fields: [
            {
              name: 'text',
              type: 'text',
              required: true,
            },
          ],
        },
        {
          name: 'sentiment',
          type: 'select',
          label: 'Sentiment',
          required: true,
          options: [
            { label: 'Positive', value: 'positive' },
            { label: 'Neutral', value: 'neutral' },
            { label: 'Negative', value: 'negative' },
            { label: 'Mixed', value: 'mixed' },
          ],
        },
        {
          name: 'sentimentScore',
          type: 'number',
          label: 'Sentiment Score',
          min: 0,
          max: 10,
          admin: {
            description: 'Score from 0 (very negative) to 10 (very positive)',
            step: 0.1,
          },
        },
      ],
    },
    {
      name: 'overallSentiment',
      type: 'select',
      label: 'Overall Sentiment',
      options: [
        { label: 'Positive', value: 'positive' },
        { label: 'Neutral', value: 'neutral' },
        { label: 'Negative', value: 'negative' },
        { label: 'Mixed', value: 'mixed' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'overallSentimentScore',
      type: 'number',
      label: 'Overall Sentiment Score',
      min: 0,
      max: 10,
      admin: {
        description: 'Aggregate score from 0 (very negative) to 10 (very positive)',
        step: 0.1,
        position: 'sidebar',
      },
    },
  ],
}
