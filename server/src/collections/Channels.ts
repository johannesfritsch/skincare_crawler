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
    group: 'Videos',
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
      index: true,
    },
    {
      name: 'canonicalUrl',
      type: 'text',
      label: 'Canonical URL',
      index: true,
      admin: {
        description: 'Platform-canonical URL (e.g. /channel/UC... for YouTube). Used for deduplication.',
      },
    },
    {
      name: 'videos',
      type: 'join',
      collection: 'videos',
      on: 'channel',
    },
  ],
}
