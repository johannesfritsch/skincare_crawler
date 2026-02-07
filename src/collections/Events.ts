import type { CollectionConfig } from 'payload'

export const Events: CollectionConfig = {
  slug: 'events',
  labels: {
    singular: 'Event',
    plural: 'Events',
  },
  admin: {
    useAsTitle: 'message',
    defaultColumns: ['type', 'message', 'job', 'createdAt'],
    group: 'System',
  },
  fields: [
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'error',
      options: [
        { label: 'Error', value: 'error' },
        { label: 'Warning', value: 'warning' },
        { label: 'Info', value: 'info' },
      ],
      index: true,
    },
    {
      name: 'message',
      type: 'textarea',
      required: true,
    },
    {
      name: 'job',
      type: 'relationship',
      relationTo: ['source-discoveries', 'source-crawls', 'ingredients-discoveries'],
      index: true,
    },
  ],
}
