import type { CollectionConfig } from 'payload'

export const ProductMedia: CollectionConfig = {
  slug: 'product-media',
  admin: {
    group: 'Media',
    description: 'Product variant images (main photos from retailers)',
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
    imageSizes: [
      {
        name: 'thumbnail',
        width: 96,
        height: 96,
        fit: 'inside',
        withoutEnlargement: true,
      },
      {
        name: 'card',
        width: 320,
        height: 240,
        fit: 'inside',
        withoutEnlargement: true,
      },
      {
        name: 'detail',
        width: 780,
        height: 780,
        fit: 'inside',
        withoutEnlargement: true,
      },
    ],
    adminThumbnail: 'thumbnail',
  },
}
