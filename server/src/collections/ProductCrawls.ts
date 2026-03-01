import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'
import { SOURCE_OPTIONS_WITH_ALL } from './shared/store-fields'

export const ProductCrawls: CollectionConfig = {
  slug: 'product-crawls',
  labels: {
    singular: 'Product Crawl',
    plural: 'Product Crawls',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'crawled', 'errors', 'startedAt'],
    group: 'Products',
  },
  hooks: {
    beforeChange: [enforceJobClaim],
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    ...jobClaimFields,
    {
      name: 'itemsPerTick',
      type: 'number',
      label: 'Batch Size',
      defaultValue: 10,
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Products to crawl per batch.',
      },
    },
    {
      name: 'crawlVariants',
      type: 'checkbox',
      label: 'Crawl Variants',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description:
          'Also crawl all variant URLs (e.g. Mueller ?itemId= variants). When off, only the default variant per product is crawled.',
      },
    },
    {
      name: 'debug',
      type: 'checkbox',
      label: 'Debug Mode',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Keep browser visible (non-headless).',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Configuration',
          fields: [
            {
              name: 'type',
              type: 'select',
              label: 'What to Crawl',
              required: true,
              defaultValue: 'selected_urls',
              options: [
                { label: 'All in Database', value: 'all' },
                { label: 'Specific URLs', value: 'selected_urls' },
                { label: 'Specific GTINs', value: 'selected_gtins' },
                { label: 'From Discovery Job', value: 'from_discovery' },
              ],
              admin: {
                description:
                  '"All in Database" processes existing source-products. The other options target specific products.',
              },
            },
            {
              name: 'source',
              type: 'select',
              label: 'Store',
              required: true,
              defaultValue: 'all',
              options: [...SOURCE_OPTIONS_WITH_ALL],
              admin: {
                description: 'Which store(s) to crawl products from.',
                condition: (data) =>
                  data?.type === 'all' || data?.type === 'selected_gtins',
              },
            },
            {
              name: 'urls',
              type: 'textarea',
              label: 'Product URLs',
              admin: {
                description:
                  'One product URL per line. The store is detected automatically from the URL.',
                condition: (data) => data?.type === 'selected_urls',
              },
            },
            {
              name: 'gtins',
              type: 'textarea',
              label: 'GTINs',
              admin: {
                description:
                  'One GTIN per line. All matching source-products across the selected store(s) will be crawled.',
                condition: (data) => data?.type === 'selected_gtins',
              },
            },
            {
              name: 'discovery',
              type: 'relationship',
              relationTo: 'product-discoveries',
              label: 'Discovery Job',
              admin: {
                description:
                  'Crawl the product URLs found by this discovery. Covers all stores that the discovery found.',
                condition: (data) => data?.type === 'from_discovery',
              },
            },
            {
              name: 'scope',
              type: 'select',
              label: 'Scope',
              required: true,
              defaultValue: 'uncrawled_only',
              options: [
                { label: 'Only Uncrawled', value: 'uncrawled_only' },
                { label: 'Re-crawl All', value: 'recrawl' },
              ],
              admin: {
                description:
                  '"Only Uncrawled" skips products that were already crawled. "Re-crawl All" resets them and crawls again.',
                condition: (data) =>
                  data?.type === 'all' || data?.type === 'selected_gtins',
              },
            },
            {
              type: 'row',
              admin: {
                condition: (data) =>
                  (data?.type === 'all' || data?.type === 'selected_gtins') &&
                  data?.scope === 'recrawl',
              },
              fields: [
                {
                  name: 'minCrawlAge',
                  type: 'number',
                  label: 'Minimum Age',
                  min: 1,
                  admin: {
                    width: '50%',
                    description:
                      'Only re-crawl products last crawled more than this long ago. Leave empty to re-crawl everything.',
                  },
                },
                {
                  name: 'minCrawlAgeUnit',
                  type: 'select',
                  label: 'Unit',
                  defaultValue: 'days',
                  options: [
                    { label: 'Minutes', value: 'minutes' },
                    { label: 'Hours', value: 'hours' },
                    { label: 'Days', value: 'days' },
                    { label: 'Weeks', value: 'weeks' },
                  ],
                  admin: {
                    width: '50%',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            {
              name: 'total',
              type: 'number',
              label: 'Total',
              admin: {
                readOnly: true,
                description: 'Total products to crawl',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'crawled',
                  type: 'number',
                  label: 'Crawled',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Products successfully crawled',
                    width: '50%',
                  },
                },
                {
                  name: 'errors',
                  type: 'number',
                  label: 'Errors',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Products that failed to crawl',
                    width: '50%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'startedAt',
                  type: 'date',
                  label: 'Started At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
                {
                  name: 'completedAt',
                  type: 'date',
                  label: 'Completed At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
              ],
            },
          ],
        },

        {
          label: 'Output',
          fields: [
            {
              name: 'crawledProducts',
              type: 'join',
              collection: 'crawl-results',
              on: 'crawl',
              admin: {
                allowCreate: false,
              },
            },
            {
              name: 'downloadGtins',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/DownloadCrawledGtinsButton',
                },
              },
            },
          ],
        },
        {
          label: 'Events',
          fields: [
            {
              name: 'events',
              type: 'join',
              collection: 'events',
              on: 'job',
            },
          ],
        },
      ],
    },
  ],
}
