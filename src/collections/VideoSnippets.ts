import type { CollectionConfig } from 'payload'

export const VideoSnippets: CollectionConfig = {
  slug: 'video-snippets',
  labels: {
    singular: 'Video Snippet',
    plural: 'Video Snippets',
  },
  admin: {
    useAsTitle: 'video',
    defaultColumns: ['video', 'timestampStart', 'timestampEnd', 'createdAt'],
    group: 'Social Media',
  },
  fields: [
    {
      name: 'video',
      type: 'relationship',
      relationTo: 'videos',
      label: 'Video',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Image',
    },
    {
      name: 'timestampStart',
      type: 'number',
      label: 'Timestamp Start',
      admin: {
        description: 'Start time in seconds',
      },
    },
    {
      name: 'timestampEnd',
      type: 'number',
      label: 'Timestamp End',
      admin: {
        description: 'End time in seconds',
      },
    },
    {
      name: 'localVideo',
      type: 'upload',
      relationTo: 'media',
      label: 'Local Video',
    },
    {
      name: 'screenshots',
      type: 'array',
      label: 'Screenshots',
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Image',
          required: true,
        },
        {
          name: 'barcode',
          type: 'text',
          label: 'Barcode',
          admin: {
            description: 'EAN-13/EAN-8 barcode detected in this screenshot',
          },
        },
      ],
    },
    {
      name: 'referencedProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Referenced Products',
    },
  ],
}
