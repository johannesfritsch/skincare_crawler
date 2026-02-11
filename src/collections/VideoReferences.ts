import type { CollectionConfig } from 'payload'

export const VideoReferences: CollectionConfig = {
  slug: 'video-references',
  labels: {
    singular: 'Video Reference',
    plural: 'Video References',
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
