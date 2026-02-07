import type { CollectionConfig } from 'payload'

export const SourceDiscoveries: CollectionConfig = {
  slug: 'source-discoveries',
  labels: {
    singular: 'Source Discovery',
    plural: 'Source Discoveries',
  },
  admin: {
    useAsTitle: 'sourceUrl',
    defaultColumns: ['sourceUrl', 'status', 'discovered', 'created', 'startedAt'],
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
        description: 'The category URL to discover products from',
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
