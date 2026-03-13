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
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'channels',
          where: { creator: { equals: id } },
          req,
        })
      },
    ],
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
      relationTo: 'profile-media',
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
