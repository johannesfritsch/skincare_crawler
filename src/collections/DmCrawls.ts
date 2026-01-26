import type { CollectionConfig } from 'payload'

export const DmCrawls: CollectionConfig = {
  slug: 'dm-crawls',
  labels: {
    singular: 'DM Crawl',
    plural: 'DM Crawls',
  },
  admin: {
    useAsTitle: 'sourceUrl',
    defaultColumns: ['sourceUrl', 'status', 'totalCount', 'itemsCrawled', 'createdAt'],
    group: 'DM Data',
    description: 'DM crawl sessions tracking discovery and crawl progress',
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Overview',
          fields: [
            {
              name: 'sourceUrl',
              type: 'text',
              label: 'Source URL',
              required: true,
              admin: {
                description: 'The dm.de category URL being crawled',
              },
            },
            {
              name: 'status',
              type: 'select',
              label: 'Status',
              defaultValue: 'pending',
              options: [
                { label: 'Pending', value: 'pending' },
                { label: 'Discovering', value: 'discovering' },
                { label: 'Discovered', value: 'discovered' },
                { label: 'Crawling', value: 'crawling' },
                { label: 'Completed', value: 'completed' },
                { label: 'Failed', value: 'failed' },
              ],
              admin: {
                description: 'Current status of the crawl',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'totalCount',
                  type: 'number',
                  label: 'Total Products',
                  admin: {
                    description: 'Total number of products reported by dm.de',
                    width: '33%',
                  },
                },
                {
                  name: 'itemsDiscovered',
                  type: 'number',
                  label: 'Items Discovered',
                  admin: {
                    description: 'Number of items discovered during discovery phase',
                    width: '33%',
                  },
                },
                {
                  name: 'itemsCrawled',
                  type: 'number',
                  label: 'Items Crawled',
                  defaultValue: 0,
                  admin: {
                    description: 'Number of items successfully crawled',
                    width: '33%',
                  },
                },
              ],
            },
            {
              name: 'itemsSummary',
              type: 'ui',
              admin: {
                components: {
                  Field: '/components/ItemsCountField',
                },
              },
            },
            {
              name: 'error',
              type: 'textarea',
              label: 'Error Message',
              admin: {
                description: 'Error message if crawl failed',
                condition: (data) => data?.status === 'failed',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'discoveredAt',
                  type: 'date',
                  label: 'Discovered At',
                  admin: {
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                    width: '50%',
                  },
                },
                {
                  name: 'completedAt',
                  type: 'date',
                  label: 'Completed At',
                  admin: {
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                    width: '50%',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Pending',
          fields: [
            {
              name: 'pendingItems',
              type: 'join',
              collection: 'dm-crawl-items',
              on: 'crawl',
              where: {
                status: { equals: 'pending' },
              },
              admin: {
                defaultColumns: ['gtin', 'status', 'productUrl'],
                allowCreate: false,
              },
            },
          ],
        },
        {
          label: 'Crawled',
          fields: [
            {
              name: 'crawledItems',
              type: 'join',
              collection: 'dm-crawl-items',
              on: 'crawl',
              where: {
                status: { equals: 'crawled' },
              },
              admin: {
                defaultColumns: ['gtin', 'status', 'productUrl'],
                allowCreate: false,
              },
            },
          ],
        },
        {
          label: 'Failed',
          fields: [
            {
              name: 'failedItems',
              type: 'join',
              collection: 'dm-crawl-items',
              on: 'crawl',
              where: {
                status: { equals: 'failed' },
              },
              admin: {
                defaultColumns: ['gtin', 'status', 'productUrl'],
                allowCreate: false,
              },
            },
          ],
        },
      ],
    },
  ],
}
