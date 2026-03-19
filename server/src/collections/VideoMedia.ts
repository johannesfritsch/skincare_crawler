import type { CollectionConfig } from 'payload'

export const VideoMedia: CollectionConfig = {
  slug: 'video-media',
  admin: {
    group: 'Media',
    description: 'Video files (MP4), thumbnails, and screenshots',
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
    mimeTypes: ['image/*', 'video/*', 'audio/*'],
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
