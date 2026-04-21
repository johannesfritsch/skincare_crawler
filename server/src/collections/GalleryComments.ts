import type { CollectionConfig } from 'payload'

export const GalleryComments: CollectionConfig = {
  slug: 'gallery-comments',
  labels: {
    singular: 'Gallery Comment',
    plural: 'Gallery Comments',
  },
  admin: {
    useAsTitle: 'username',
    defaultColumns: ['username', 'text', 'likeCount', 'createdAt'],
    group: 'Galleries',
  },
  fields: [
    {
      name: 'gallery',
      type: 'relationship',
      relationTo: 'galleries',
      label: 'Gallery',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'externalId',
      type: 'text',
      label: 'External ID',
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Instagram comment PK — used for deduplication',
      },
    },
    {
      name: 'username',
      type: 'text',
      label: 'Username',
      required: true,
    },
    {
      name: 'text',
      type: 'textarea',
      label: 'Text',
      required: true,
    },
    {
      name: 'createdAt',
      type: 'date',
      label: 'Created At',
      admin: {
        description: 'When the comment was posted on Instagram',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'likeCount',
      type: 'number',
      label: 'Like Count',
      defaultValue: 0,
    },
  ],
}
