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
      name: 'embeddedPlayer',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/EmbeddedVideoPlayer',
        },
      },
    },
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
      name: 'processingStatus',
      type: 'select',
      label: 'Processing Status',
      defaultValue: 'unprocessed',
      options: [
        { label: 'Unprocessed', value: 'unprocessed' },
        { label: 'Processed', value: 'processed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'externalUrl',
      type: 'text',
      label: 'External URL',
    },
    {
      name: 'videoSnippets',
      type: 'join',
      collection: 'video-snippets',
      on: 'video',
    },
  ],
}
