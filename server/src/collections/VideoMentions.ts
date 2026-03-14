import type { CollectionConfig } from 'payload'

export const VideoMentions: CollectionConfig = {
  slug: 'video-mentions',
  labels: {
    singular: 'Video Mention',
    plural: 'Video Mentions',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['product', 'confidence', 'overallSentiment', 'overallSentimentScore'],
    group: 'Videos',
  },
  fields: [
    {
      name: 'videoScene',
      type: 'relationship',
      relationTo: 'video-scenes',
      label: 'Video Scene',
      required: true,
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
      ],
      admin: {
        position: 'sidebar',
        description: 'Which detection methods identified this product',
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
        description: 'Best CLIP cosine distance if detected via object detection',
      },
    },

    // ── Sentiment (from LLM analysis) ──
    {
      name: 'quotes',
      type: 'array',
      label: 'Quotes',
      admin: {
        description: 'Spoken quotes about this product extracted from the scene transcript',
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
          type: 'json',
          label: 'Summary',
          admin: {
            description: 'Short key takeaways from the quote, true to original wording',
          },
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
          min: -1,
          max: 1,
          admin: {
            description: 'Score from -1 (very negative) to 1 (very positive)',
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
      min: -1,
      max: 1,
      admin: {
        description: 'Aggregate score from -1 (very negative) to 1 (very positive)',
        step: 0.1,
        position: 'sidebar',
      },
    },
  ],
}
