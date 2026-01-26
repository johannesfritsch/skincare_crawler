import type { CollectionConfig } from 'payload'

export const DmCrawlItems: CollectionConfig = {
  slug: 'dm-crawl-items',
  admin: {
    hidden: true,
    useAsTitle: 'gtin',
    defaultColumns: ['gtin', 'productUrl', 'status', 'createdAt'],
  },
  fields: [
    {
      name: 'crawl',
      type: 'relationship',
      relationTo: 'dm-crawls',
      required: true,
      index: true,
    },
    {
      name: 'gtin',
      type: 'text',
      label: 'GTIN',
      required: true,
      index: true,
    },
    {
      name: 'productUrl',
      type: 'text',
      label: 'Product URL',
    },
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Crawled', value: 'crawled' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: {
        components: {
          Cell: '/components/CrawlItemStatusCell',
        },
      },
    },
  ],
}
