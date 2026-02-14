import type { CollectionConfig } from 'payload'

export const SourceCrawls: CollectionConfig = {
  slug: 'source-crawls',
  labels: {
    singular: 'Source Crawl',
    plural: 'Source Crawls',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'crawled', 'errors', 'startedAt'],
    group: 'Jobs',
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
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Configuration',
          fields: [
            {
              name: 'source',
              type: 'select',
              label: 'Source',
              required: true,
              defaultValue: 'all',
              options: [
                { label: 'All Sources', value: 'all' },
                { label: 'DM', value: 'dm' },
                { label: 'Rossmann', value: 'rossmann' },
                { label: 'Müller', value: 'mueller' },
              ],
            },
            {
              name: 'type',
              type: 'select',
              label: 'Products',
              required: true,
              defaultValue: 'all',
              options: [
                { label: 'All Products', value: 'all' },
                { label: 'Selected URLs', value: 'selected_urls' },
                { label: 'From Discovery', value: 'from_discovery' },
              ],
            },
            {
              name: 'urls',
              type: 'textarea',
              label: 'Product URLs',
              admin: {
                description: 'Product URLs to crawl, one per line',
                condition: (data) => data?.type === 'selected_urls',
              },
            },
            {
              name: 'discovery',
              type: 'relationship',
              relationTo: 'source-discoveries',
              label: 'Discovery',
              admin: {
                description: 'Use product URLs from this completed discovery',
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
                { label: 'Uncrawled Only', value: 'uncrawled_only' },
                { label: 'Re-crawl', value: 'recrawl' },
              ],
              admin: {
                description:
                  'Uncrawled Only skips already-crawled products. Re-crawl includes them.',
              },
            },
            {
              type: 'row',
              admin: {
                condition: (data) => data?.scope === 'recrawl',
              },
              fields: [
                {
                  name: 'minCrawlAge',
                  type: 'number',
                  label: 'Minimum Crawl Age',
                  min: 1,
                  admin: {
                    width: '50%',
                    description:
                      'Only re-crawl products older than this. Leave empty to re-crawl all.',
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
          label: 'Pacing',
          fields: [
            {
              name: 'debug',
              type: 'checkbox',
              label: 'Debug Mode',
              defaultValue: false,
              admin: {
                description:
                  'Keep browser visible for inspection (non-headless). Only works for browser-based drivers.',
              },
            },
            {
              name: 'itemsPerTick',
              type: 'number',
              label: 'Items Per Tick',
              defaultValue: 10,
              min: 1,
              admin: {
                description: 'Number of products to crawl per tick.',
              },
            },
          ],
        },
        {
          label: 'Output',
          fields: [
            {
              name: 'crawledGtins',
              type: 'textarea',
              label: 'Crawled GTINs',
              admin: {
                readOnly: true,
                description: 'GTINs of successfully crawled products, one per line',
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
