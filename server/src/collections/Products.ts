import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: 'Product',
    plural: 'Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'brand', 'productType', 'createdAt'],
    listSearchableFields: ['name'],
    group: 'Products',
    components: {
      edit: {
        SaveButton: '@/components/ProductSaveButton',
      },
      listMenuItems: ['@/components/bulk-actions/ProductBulkActions'],
      beforeListTable: ['@/components/bulk-actions/ProductBulkStatus'],
    },
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'product-variants',
          where: { product: { equals: id } },
          req,
        })
        await req.payload.delete({
          collection: 'video-mentions',
          where: { product: { equals: id } },
          req,
        })
      },
    ],
  },
  fields: [
    {
      name: 'brand',
      type: 'relationship',
      relationTo: 'brands',
      label: 'Brand',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'productType',
      type: 'relationship',
      relationTo: 'product-types',
      label: 'Product Type',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'aggregateStatus',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/ProductJobStatus',
        },
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Product',
          fields: [
            {
              name: 'name',
              type: 'text',
              label: 'Product Name',
            },
          ],
        },
        {
          label: 'Variants',
          fields: [
            {
              name: 'variants',
              type: 'join',
              collection: 'product-variants',
              on: 'product',
              admin: {
                defaultColumns: ['label', 'gtin'],
                description: 'Product variants — each has its own GTIN, ingredients, images, description, attributes, and claims',
              },
            },
          ],
        },
        {
          label: 'In Videos',
          fields: [
            {
              name: 'videoSnippets',
              type: 'join',
              collection: 'video-snippets',
              on: 'referencedProducts',
            },
            {
              name: 'videoMentions',
              type: 'join',
              collection: 'video-mentions',
              on: 'product',
              admin: {
                defaultColumns: ['videoSnippet', 'overallSentiment', 'overallSentimentScore'],
              },
            },
          ],
        },
        {
          label: 'Scoring',
          fields: [
            {
              name: 'scoreHistory',
              type: 'array',
              label: 'Score History',
              admin: {
                description: 'Timestamped snapshots of store and creator scores, recorded during each aggregation run',
              },
              fields: [
                {
                  name: 'recordedAt',
                  type: 'date',
                  label: 'Recorded At',
                  required: true,
                  admin: { date: { pickerAppearance: 'dayAndTime' } },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'storeScore',
                      type: 'number',
                      label: 'Store Score (0–10)',
                      min: 0,
                      max: 10,
                      admin: { step: 0.1, width: '33%' },
                    },
                    {
                      name: 'creatorScore',
                      type: 'number',
                      label: 'Creator Score (0–10)',
                      min: 0,
                      max: 10,
                      admin: { step: 0.1, width: '33%' },
                    },
                    {
                      name: 'change',
                      type: 'select',
                      label: 'Change',
                      options: [
                        { label: 'Drop', value: 'drop' },
                        { label: 'Stable', value: 'stable' },
                        { label: 'Increase', value: 'increase' },
                      ],
                      admin: {
                        width: '33%',
                        description: 'Score movement vs previous record (>= 5% relative change)',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'Aggregations',
          fields: [
            {
              name: 'aggregations',
              type: 'join',
              collection: 'product-aggregations',
              on: 'products',
              admin: { allowCreate: false },
            },
          ],
        },
        {
          label: 'Sources',
          fields: [
            {
              name: 'sourceProducts',
              type: 'relationship',
              relationTo: 'source-products',
              hasMany: true,
              label: 'Source Products',
              admin: {
                description: 'Links to crawled source product data',
              },
            },
          ],
        },
      ],
    },
  ],
}
