import type { CollectionConfig } from 'payload'
import { SOURCE_OPTIONS } from './shared/store-fields'

export const SourceProducts: CollectionConfig = {
  slug: 'source-products',
  labels: {
    singular: 'Source Product',
    plural: 'Source Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'brandName', 'source', 'status', 'createdAt'],
    group: 'Source Products',
    description: 'Products crawled from source stores',
    listSearchableFields: ['name', 'brandName'],
    components: {
      edit: {
        SaveButton: '@/components/SourceProductSaveButton',
      },
      listMenuItems: ['@/components/bulk-actions/SourceProductBulkActions'],
      beforeListTable: ['@/components/bulk-actions/SourceProductBulkStatus'],
    },
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'source-variants',
          where: { sourceProduct: { equals: id } },
          req,
        })
        await req.payload.delete({
          collection: 'crawl-results',
          where: { sourceProduct: { equals: id } },
          req,
        })
        await req.payload.delete({
          collection: 'discovery-results',
          where: { sourceProduct: { equals: id } },
          req,
        })
        await req.payload.delete({
          collection: 'search-results',
          where: { sourceProduct: { equals: id } },
          req,
        })
      },
    ],
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'uncrawled',
      options: [
        { label: 'Uncrawled', value: 'uncrawled' },
        { label: 'Crawled', value: 'crawled' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'source',
      type: 'select',
      label: 'Source',
      index: true,
      options: [...SOURCE_OPTIONS],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Product page URL at the source store (dedup key)',
      },
    },
    {
      name: 'crawlStatus',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/SourceProductJobStatus',
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
              name: 'brandName',
              type: 'text',
              label: 'Brand',
              admin: {
                description: 'Product brand name',
              },
              index: true,
            },
            {
              name: 'name',
              type: 'text',
              label: 'Product Name',
            },
            {
              name: 'categoryBreadcrumb',
              type: 'text',
              label: 'Category',
              admin: {
                description: 'Category breadcrumb, e.g. "Pflege -> Körperpflege -> Handcreme"',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'rating',
                  type: 'number',
                  label: 'Rating',
                  min: 0,
                  max: 5,
                  admin: {
                    description: 'Average rating (0-5)',
                    width: '50%',
                  },
                },
                {
                  name: 'ratingNum',
                  type: 'number',
                  label: 'Number of Reviews',
                  admin: {
                    description: 'Total number of reviews',
                    width: '50%',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Labels',
          fields: [
            {
              name: 'labels',
              type: 'array',
              label: 'Labels',
              admin: {
                description: 'Product labels (e.g., Neu, Limitiert, dm-Marke)',
              },
              fields: [
                {
                  name: 'label',
                  type: 'text',
                  required: true,
                },
              ],
            },
          ],
        },
        {
          label: 'Variants',
          fields: [
            {
              name: 'sourceVariants',
              type: 'join',
              collection: 'source-variants',
              on: 'sourceProduct',
              admin: {
                defaultColumns: ['variantLabel', 'variantDimension', 'gtin', 'sourceArticleNumber'],
              },
            },
            {
              name: 'downloadVariantGtins',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/DownloadVariantGtinsButton',
                },
              },
            },
          ],
        },

        
        {
          label: 'History',
          fields: [
            {
              name: 'discoveries',
              type: 'join',
              collection: 'discovery-results',
              on: 'sourceProduct',
              admin: { allowCreate: false },
            },
            {
              name: 'crawls',
              type: 'join',
              collection: 'crawl-results',
              on: 'sourceProduct',
              admin: { allowCreate: false },
            },
          ],
        },
      ],
    },
  ],
}
