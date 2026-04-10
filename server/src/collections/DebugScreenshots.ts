import type { CollectionConfig } from 'payload'

export const DebugScreenshots: CollectionConfig = {
  slug: 'debug-screenshots',
  admin: {
    group: 'System',
    description: 'Browser screenshots captured during debug-mode crawls, discoveries, and searches',
    defaultColumns: ['alt', 'job', 'createdAt'],
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
    {
      name: 'job',
      type: 'relationship',
      relationTo: ['product-crawls', 'product-discoveries', 'product-searches', 'bot-checks'],
      index: true,
    },
    {
      name: 'step',
      type: 'text',
      admin: {
        description: 'Which step produced this screenshot (e.g. "brand_url_extraction", "product_page")',
      },
    },
    {
      name: 'url',
      type: 'text',
      admin: {
        description: 'The page URL at the time of the screenshot',
      },
    },
  ],
  upload: {
    adminThumbnail: 'thumbnail',
    imageSizes: [
      {
        name: 'thumbnail',
        width: 400,
        height: 300,
        fit: 'inside',
      },
    ],
    mimeTypes: ['image/png', 'image/jpeg'],
  },
}
