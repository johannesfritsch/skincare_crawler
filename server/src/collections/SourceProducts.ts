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
    defaultColumns: ['name', 'sourceBrand', 'source', 'createdAt'],
    group: 'Products',
    description: 'Products crawled from source stores',
    listSearchableFields: ['name'],
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
        // Cascade delete: remove child source-reviews (owned by source-product)
        await req.payload.delete({
          collection: 'source-reviews',
          where: { sourceProduct: { equals: id } },
          req,
        })
        // Cascade delete: remove child source-variants (required NOT NULL reference)
        await req.payload.delete({
          collection: 'source-variants',
          where: { sourceProduct: { equals: id } },
          req,
        })
        // Clean up product-variant attribute/claim evidence rows that reference this source-product.
        // These sub-tables have source_product_id NOT NULL with ON DELETE SET NULL — a contradiction
        // that causes deletion to fail. Remove the evidence rows directly via SQL.
        const db = req.payload.db
        if ('drizzle' in db) {
          const drizzle = db.drizzle as import('drizzle-orm/node-postgres').NodePgDatabase
          const { sql } = await import('drizzle-orm')
          await drizzle.execute(
            sql`DELETE FROM product_variants_product_attributes WHERE source_product_id = ${id}`,
          )
          await drizzle.execute(
            sql`DELETE FROM product_variants_product_claims WHERE source_product_id = ${id}`,
          )
        }
      },
    ],
  },
  fields: [
    // ── Sidebar ──
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Product page URL at the source store (dedup key)',
        components: {
          Field: '@/components/SourceUrlField',
        },
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
        components: {
          Cell: '@/components/SourceUrlCell',
        },
      },
    },

    {
      name: 'sourceBrand',
      type: 'relationship',
      relationTo: 'source-brands',
      label: 'Brand',
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Brand from source store',
      },
    },
    {
      name: 'sourceArticleNumber',
      type: 'text',
      label: 'Article Number',
      admin: {
        position: 'sidebar',
        description: 'Store-specific product-level ID (e.g., Shopify product ID for PURISH)',
      },
    },
    {
      name: 'categoryBreadcrumb',
      type: 'text',
      label: 'Category',
      admin: {
        position: 'sidebar',
        description: 'Category breadcrumb, e.g. "Pflege -> Körperpflege -> Handcreme"',
      },
    },
    {
      name: 'averageRating',
      type: 'number',
      label: 'Average Rating',
      min: 0,
      max: 5,
      admin: {
        position: 'sidebar',
        description: 'Average rating (0-5)',
      },
    },
    {
      name: 'ratingCount',
      type: 'number',
      label: 'Review Count',
      admin: {
        position: 'sidebar',
        description: 'Total number of reviews',
      },
    },

    // ── Main area ──
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
              name: 'name',
              type: 'text',
              label: 'Product Name',
            },
            {
              name: 'sourceVariants',
              type: 'join',
              collection: 'source-variants',
              on: 'sourceProduct',
              admin: {
                defaultColumns: [
                  'variantDimension',
                  'variantLabel',
                  'gtin',
                  'pzn',
                  'sourceArticleNumber',
                ],
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
          label: 'Reviews',
          fields: [
            {
              name: 'sourceReviews',
              type: 'join',
              collection: 'source-reviews',
              on: 'sourceProduct',
              admin: {
                defaultColumns: ['rating', 'title', 'userNickname', 'submittedAt'],
              },
            },
          ],
        },
      ],
    },
  ],
}
