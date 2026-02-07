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
              name: 'type',
              type: 'select',
              label: 'Type',
              required: true,
              defaultValue: 'all',
              options: [
                { label: 'All Uncrawled', value: 'all' },
                { label: 'Selected GTINs', value: 'selected_gtins' },
              ],
            },
            {
              name: 'gtins',
              type: 'array',
              label: 'GTINs',
              admin: {
                description: 'List of GTINs to crawl',
                condition: (data) => data?.type === 'selected_gtins',
              },
              fields: [
                {
                  name: 'gtin',
                  type: 'text',
                  required: true,
                },
              ],
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
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
