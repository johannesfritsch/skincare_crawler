import type { CollectionConfig } from 'payload'

export const ProductSentiments: CollectionConfig = {
  slug: 'product-sentiments',
  labels: {
    singular: 'Product Sentiment',
    plural: 'Product Sentiments',
  },
  admin: {
    useAsTitle: 'topic',
    defaultColumns: ['product', 'topic', 'sentiment', 'amount'],
    group: 'Products',
    hidden: true,
    description: 'Aggregated per-product topic sentiment counts from source reviews',
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
      name: 'sentiment',
      type: 'select',
      required: true,
      options: [
        { label: 'Positive', value: 'positive' },
        { label: 'Neutral', value: 'neutral' },
        { label: 'Negative', value: 'negative' },
      ],
    },
    {
      name: 'reviewOrigin',
      type: 'relationship',
      relationTo: 'source-review-origins',
      admin: {
        description: 'Syndication source origin. Null = native/no syndication.',
      },
    },
    {
      name: 'amount',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description: 'Count of reviews with this topic+sentiment combination',
      },
    },
  ],
}
