import type { CollectionConfig } from 'payload'

export const ProfileMedia: CollectionConfig = {
  slug: 'profile-media',
  admin: {
    group: 'Media',
    description: 'Channel avatars, creator images, and ingredient images',
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
        name: 'avatar',
        width: 128,
        height: 128,
        fit: 'inside',
        withoutEnlargement: true,
      },
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
    ],
    adminThumbnail: 'thumbnail',
  },
}
