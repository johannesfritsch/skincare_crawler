import type { CollectionConfig } from 'payload'

export const Videos: CollectionConfig = {
  slug: 'videos',
  labels: {
    singular: 'Video',
    plural: 'Videos',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'channel', 'createdAt'],
    group: 'Social Media',
  },
  fields: [
    {
      name: 'channel',
      type: 'relationship',
      relationTo: 'channels',
      label: 'Channel',
      required: true,
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Image',
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Published At',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'externalUrl',
      type: 'text',
      label: 'External URL',
    },
    {
      name: 'videoReferences',
      type: 'join',
      collection: 'video-references',
      on: 'video',
    },
  ],
}
