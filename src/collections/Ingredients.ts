import type { CollectionConfig } from 'payload'

export const Ingredients: CollectionConfig = {
  slug: 'ingredients',
  labels: {
    singular: 'Ingredient',
    plural: 'Ingredients',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'crawledAt', 'createdAt'],
    group: 'Content',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Ingredient Name',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'recrawl',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/RecrawlIngredientButton',
        },
      },
    },
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Crawled', value: 'crawled' },
        { label: 'Crawl Failed', value: 'crawl_failed' },
        { label: 'Not Found', value: 'crawl_not_found' },
      ],
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      admin: {
        description: 'SpecialChem INCI page URL',
      },
    },
    {
      name: 'crawledAt',
      type: 'date',
      label: 'Last Crawled At',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
  ],
}
