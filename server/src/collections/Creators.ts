import type { CollectionConfig } from 'payload'

export const Creators: CollectionConfig = {
  slug: 'creators',
  labels: {
    singular: 'Creator',
    plural: 'Creators',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
    group: 'Videos',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Name',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Image',
    },
    {
      name: 'channels',
      type: 'join',
      collection: 'channels',
      on: 'creator',
    },
  ],
}
