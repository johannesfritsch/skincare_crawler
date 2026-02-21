import type { CollectionConfig } from 'payload'

export const CategoryDiscoveries: CollectionConfig = {
  slug: 'category-discoveries',
  labels: {
    singular: 'Category Discovery',
    plural: 'Category Discoveries',
  },
  admin: {
    useAsTitle: 'storeUrls',
    defaultColumns: ['storeUrls', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Jobs',
  },
  fields: [
    {
      name: 'storeUrls',
      type: 'textarea',
      label: 'Store URLs',
      required: true,
      admin: {
        description: 'Store URLs to discover categories from (e.g. dm.de, mueller.de), one per line.',
      },
    },
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
          label: 'Progress',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'discovered',
                  type: 'number',
                  label: 'Discovered',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Categories found',
                    width: '33%',
                  },
                },
                {
                  name: 'created',
                  type: 'number',
                  label: 'Created',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'New categories created',
                    width: '33%',
                  },
                },
                {
                  name: 'existing',
                  type: 'number',
                  label: 'Existing',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Categories already in database',
                    width: '33%',
                  },
                },
              ],
            },
            {
              name: 'progress',
              type: 'json',
              label: 'Progress State',
              admin: {
                readOnly: true,
                description: 'Internal state for resumable discovery',
              },
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
              name: 'categoryUrls',
              type: 'textarea',
              label: 'Discovered Category URLs',
              validate: () => true,
              admin: {
                readOnly: true,
                description: 'Discovered category URLs, one per line',
              },
            },
            {
              name: 'errorUrls',
              type: 'textarea',
              label: 'Failed URLs',
              validate: () => true,
              admin: {
                readOnly: true,
                description: 'URLs that failed during discovery (e.g. timeouts), one per line. Can be copied into Store URLs to retry.',
              },
            },
          ],
        },
        {
          label: 'Pacing',
          fields: [
            {
              name: 'itemsPerTick',
              type: 'number',
              label: 'Items Per Tick',
              min: 1,
              admin: {
                description: 'Max categories to save per tick. Leave empty for unlimited.',
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
      admin: {
        condition: (data) => !!data?.id,
      },
    },
  ],
}
