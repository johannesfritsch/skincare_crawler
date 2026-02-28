import type { CollectionConfig } from 'payload'

export const Events: CollectionConfig = {
  slug: 'events',
  labels: {
    singular: 'Event',
    plural: 'Events',
  },
  admin: {
    useAsTitle: 'message',
    defaultColumns: ['type', 'level', 'component', 'message', 'job', 'createdAt'],
    group: 'System',
  },
  fields: [
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'error',
      options: [
        { label: 'Start', value: 'start' },
        { label: 'Success', value: 'success' },
        { label: 'Info', value: 'info' },
        { label: 'Warning', value: 'warning' },
        { label: 'Error', value: 'error' },
      ],
      index: true,
    },
    {
      name: 'level',
      type: 'select',
      options: [
        { label: 'Debug', value: 'debug' },
        { label: 'Info', value: 'info' },
        { label: 'Warn', value: 'warn' },
        { label: 'Error', value: 'error' },
      ],
      defaultValue: 'info',
      index: true,
    },
    {
      name: 'component',
      type: 'select',
      options: [
        { label: 'Worker', value: 'worker' },
        { label: 'Server', value: 'server' },
      ],
      defaultValue: 'worker',
      index: true,
    },
    {
      name: 'labels',
      type: 'array',
      fields: [{ name: 'label', type: 'text', required: true }],
    },
    {
      name: 'message',
      type: 'textarea',
      required: true,
    },
    {
      name: 'job',
      type: 'relationship',
      relationTo: ['product-discoveries', 'product-searches', 'product-crawls', 'ingredients-discoveries', 'product-aggregations', 'video-discoveries', 'video-processings', 'ingredient-crawls'],
      index: true,
    },
  ],
}
