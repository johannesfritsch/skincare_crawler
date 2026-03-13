import type { CollectionConfig } from 'payload'

export const DetectionMedia: CollectionConfig = {
  slug: 'detection-media',
  admin: {
    group: 'Media',
    description: 'Grounding DINO detection crops (product and video)',
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    adminThumbnail: undefined,
  },
}
