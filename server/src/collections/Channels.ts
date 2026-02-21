import type { CollectionConfig } from 'payload'

export const Channels: CollectionConfig = {
  slug: 'channels',
  labels: {
    singular: 'Channel',
    plural: 'Channels',
  },
  admin: {
    useAsTitle: 'externalUrl',
    defaultColumns: ['creator', 'platform', 'createdAt'],
    group: 'Social Media',
  },
  fields: [
    {
      name: 'creator',
      type: 'relationship',
      relationTo: 'creators',
      label: 'Creator',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Image',
    },
    {
      name: 'platform',
      type: 'select',
      label: 'Platform',
      required: true,
      options: [
        { label: 'YouTube', value: 'youtube' },
        { label: 'Instagram', value: 'instagram' },
        { label: 'TikTok', value: 'tiktok' },
      ],
    },
    {
      name: 'externalUrl',
      type: 'text',
      label: 'External URL',
    },
    {
      name: 'videos',
      type: 'join',
      collection: 'videos',
      on: 'channel',
    },
  ],
}
