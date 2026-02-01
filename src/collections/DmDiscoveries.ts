import type { CollectionConfig } from 'payload'

export const DmDiscoveries: CollectionConfig = {
  slug: 'dm-discoveries',
  labels: {
    singular: 'DM Discovery',
    plural: 'DM Discoveries',
  },
  admin: {
    useAsTitle: 'sourceUrl',
    defaultColumns: ['sourceUrl', 'status', 'itemsDiscovered', 'itemsCrawled', 'createdAt'],
    group: 'Jobs',
  },
  fields: [
    // Main configuration - always visible
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      required: true,
      admin: {
        description: 'The dm.de category URL to discover products from',
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
      index: true,
    },
    // Everything below only shows after creation
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Progress',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'totalCount',
                  type: 'number',
                  label: 'Total Products',
                  admin: {
                    readOnly: true,
                    description: 'Total products reported by dm.de',
                    width: '25%',
                  },
                },
                {
                  name: 'itemsDiscovered',
                  type: 'number',
                  label: 'Discovered',
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
                {
                  name: 'itemsCrawled',
                  type: 'number',
                  label: 'Crawled',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
                {
                  name: 'itemsFailed',
                  type: 'number',
                  label: 'Failed',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'discoveredAt',
                  type: 'date',
                  label: 'Discovered At',
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
          label: 'Items',
          fields: [
            {
              name: 'pendingItems',
              type: 'join',
              collection: 'dm-discovery-items',
              on: 'discovery',
              where: {
                status: { equals: 'pending' },
              },
              admin: {
                defaultColumns: ['gtin', 'status', 'productUrl'],
                allowCreate: false,
              },
            },
            {
              name: 'crawledItems',
              type: 'join',
              collection: 'dm-discovery-items',
              on: 'discovery',
              where: {
                status: { equals: 'crawled' },
              },
              admin: {
                defaultColumns: ['gtin', 'status', 'productUrl'],
                allowCreate: false,
              },
            },
            {
              name: 'failedItems',
              type: 'join',
              collection: 'dm-discovery-items',
              on: 'discovery',
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
        {
          label: 'Details',
          fields: [
            {
              name: 'error',
              type: 'textarea',
              label: 'Error Message',
              admin: {
                readOnly: true,
                condition: (data) => data?.status === 'failed',
              },
            },
          ],
        },
      ],
      admin: {
        condition: (data) => !!data?.id,
      },
    },
  ],
}
