import type { CollectionConfig } from 'payload'

export const Workers: CollectionConfig = {
  slug: 'workers',
  labels: {
    singular: 'Worker',
    plural: 'Workers',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'capabilities', 'status', 'lastSeenAt'],
    group: 'System',
  },
  auth: {
    useAPIKey: true,
    disableLocalStrategy: true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'capabilities',
      type: 'select',
      hasMany: true,
      required: true,
      options: [
        { label: 'Product Crawl', value: 'product-crawl' },
        { label: 'Product Discovery', value: 'product-discovery' },

        { label: 'Ingredients Discovery', value: 'ingredients-discovery' },
        { label: 'Video Discovery', value: 'video-discovery' },
        { label: 'Video Processing', value: 'video-processing' },
        { label: 'Product Aggregation', value: 'product-aggregation' },
        { label: 'Ingredient Crawl', value: 'ingredient-crawl' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Disabled', value: 'disabled' },
      ],
      index: true,
    },
    {
      name: 'lastSeenAt',
      type: 'date',
      admin: {
        readOnly: true,
      },
    },
  ],
}
