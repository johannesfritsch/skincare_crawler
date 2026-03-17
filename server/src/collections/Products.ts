import type { CollectionConfig } from 'payload'
import { sql } from 'drizzle-orm'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: 'Product',
    plural: 'Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['productImage', 'name', 'brand', 'productStores', 'productType', 'createdAt'],
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
        // Delete video_scenes_detections rows that reference this product.
        // The detections.product FK is NOT NULL + ON DELETE SET NULL which is
        // contradictory — SET NULL would violate the NOT NULL constraint.
        // Raw SQL is needed because detections are array sub-rows, not top-level docs.
        const db = req.payload.db.drizzle
        await db.execute(
          sql`DELETE FROM video_scenes_detections WHERE product_id = ${id}`,
        )

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
      name: 'productImage',
      type: 'ui',
      admin: {
        disableListColumn: false,
        components: {
          Cell: '/components/ProductImageCell',
        },
      },
    },
    {
      name: 'productStores',
      type: 'ui',
      admin: {
        disableListColumn: false,
        components: {
          Cell: '/components/ProductStoresCell',
        },
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
          label: 'Variants',
          fields: [
            {
              name: 'variantsGallery',
              type: 'ui',
              admin: {
                components: {
                  Field: '/components/VariantsGallery',
                },
              },
            },
          ],
        },
        {
          label: 'Product Details',
          fields: [
            {
              name: 'name',
              type: 'text',
              label: 'Product Name',
              admin: {
                components: {
                  Cell: '/components/ProductNameCell',
                },
              },
            },
            {
              name: 'brand',
              type: 'relationship',
              relationTo: 'brands',
              label: 'Brand',
            },
            {
              name: 'productType',
              type: 'relationship',
              relationTo: 'product-types',
              label: 'Product Type',
            },
          ],
        },
        {
          label: 'In Videos',
          fields: [
            {
              name: 'videoMentions',
              type: 'join',
              collection: 'video-mentions',
              on: 'product',
              admin: {
                defaultColumns: ['videoScene', 'confidence', 'overallSentiment', 'overallSentimentScore'],
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
                      admin: { step: 0.1, width: '25%' },
                    },
                    {
                      name: 'storeScoreChange',
                      type: 'select',
                      label: 'Store Change',
                      options: [
                        { label: 'Drop', value: 'drop' },
                        { label: 'Stable', value: 'stable' },
                        { label: 'Increase', value: 'increase' },
                      ],
                      admin: {
                        width: '25%',
                        description: 'Store score movement vs previous (>= 5% relative)',
                      },
                    },
                    {
                      name: 'creatorScore',
                      type: 'number',
                      label: 'Creator Score (0–10)',
                      min: 0,
                      max: 10,
                      admin: { step: 0.1, width: '25%' },
                    },
                    {
                      name: 'creatorScoreChange',
                      type: 'select',
                      label: 'Creator Change',
                      options: [
                        { label: 'Drop', value: 'drop' },
                        { label: 'Stable', value: 'stable' },
                        { label: 'Increase', value: 'increase' },
                      ],
                      admin: {
                        width: '25%',
                        description: 'Creator score movement vs previous (>= 5% relative)',
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
