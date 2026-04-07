import type { CollectionConfig } from 'payload'

export const ProductSentimentConclusions: CollectionConfig = {
  slug: 'product-sentiment-conclusions',
  labels: {
    singular: 'Product Sentiment Conclusion',
    plural: 'Product Sentiment Conclusions',
  },
  admin: {
    useAsTitle: 'topic',
    defaultColumns: ['product', 'topic', 'conclusion', 'strength'],
    group: 'Products',
  },
  fields: [
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'topic',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Smell', value: 'smell' },
        { label: 'Texture', value: 'texture' },
        { label: 'Color', value: 'color' },
        { label: 'Consistency', value: 'consistency' },
        { label: 'Absorption', value: 'absorption' },
        { label: 'Stickiness', value: 'stickiness' },
        { label: 'Lather', value: 'lather' },
        { label: 'Efficacy', value: 'efficacy' },
        { label: 'Longevity', value: 'longevity' },
        { label: 'Finish', value: 'finish' },
        { label: 'After Feel', value: 'afterFeel' },
        { label: 'Skin Tolerance', value: 'skinTolerance' },
        { label: 'Allergen Potential', value: 'allergenPotential' },
        { label: 'Dispensing', value: 'dispensing' },
        { label: 'Travel Safety', value: 'travelSafety' },
        { label: 'Animal Testing', value: 'animalTesting' },
      ],
    },
    {
      name: 'groupType',
      type: 'select',
      required: true,
      defaultValue: 'all',
      index: true,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Incentivized', value: 'incentivized' },
        { label: 'Organic', value: 'organic' },
        { label: 'Individual Origin', value: 'individual' },
      ],
      admin: {
        description: 'Which origin group this conclusion belongs to',
      },
    },
    {
      name: 'reviewOrigin',
      type: 'relationship',
      relationTo: 'source-review-origins',
      admin: {
        description: 'For individual origin conclusions. Null for aggregate groups (all/incentivized/organic).',
        condition: (data) => data?.groupType === 'individual',
      },
    },
    {
      name: 'conclusion',
      type: 'select',
      required: true,
      options: [
        { label: 'Overall Positive', value: 'positive' },
        { label: 'Overall Negative', value: 'negative' },
        { label: 'Divided', value: 'divided' },
      ],
      admin: {
        description: 'Overall sentiment direction for this topic based on review analysis',
      },
    },
    {
      name: 'strength',
      type: 'select',
      required: true,
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Ultra', value: 'ultra' },
      ],
      admin: {
        description: 'Strength of the conclusion based on review volume (low: 5-9, medium: 10-24, high: 25-49, ultra: 50+)',
      },
    },
    {
      name: 'volume',
      type: 'number',
      admin: {
        description: 'Total number of reviews mentioning this topic',
      },
    },
  ],
}
