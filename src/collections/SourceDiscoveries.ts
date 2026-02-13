import type { CollectionConfig } from 'payload'

export const SourceDiscoveries: CollectionConfig = {
  slug: 'source-discoveries',
  labels: {
    singular: 'Source Discovery',
    plural: 'Source Discoveries',
  },
  admin: {
    useAsTitle: 'sourceUrls',
    defaultColumns: ['sourceUrls', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Jobs',
  },
  fields: [
    // Main configuration - always visible
    {
      name: 'sourceUrls',
      type: 'textarea',
      label: 'Source URLs',
      required: true,
      admin: {
        description: 'Category or product URLs, one per line. Product URLs (e.g. dm.de/...-p1234.html) create source products directly.',
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
                  name: 'discovered',
                  type: 'number',
                  label: 'Discovered',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Products found on the page',
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
                    description: 'New products created',
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
                    description: 'Products already in database',
                    width: '33%',
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
              name: 'productUrls',
              type: 'textarea',
              label: 'Discovered Product URLs',
              admin: {
                readOnly: true,
                description: 'Discovered product URLs, one per line',
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
                description: 'Max products to save per tick. Leave empty for unlimited.',
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
