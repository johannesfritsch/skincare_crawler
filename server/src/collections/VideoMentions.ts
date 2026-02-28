import type { CollectionConfig } from 'payload'

export const VideoMentions: CollectionConfig = {
  slug: 'video-mentions',
  labels: {
    singular: 'Video Mention',
    plural: 'Video Mentions',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['product', 'overallSentiment', 'overallSentimentScore'],
    group: 'Videos',
  },
  fields: [
    {
      name: 'videoSnippet',
      type: 'relationship',
      relationTo: 'video-snippets',
      label: 'Video Snippet',
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
    {
      name: 'quotes',
      type: 'array',
      label: 'Quotes',
      admin: {
        description: 'Spoken quotes about this product extracted from the video snippet',
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
