import type { CollectionConfig } from 'payload'

export const DmDiscoveryItems: CollectionConfig = {
  slug: 'dm-discovery-items',
  admin: {
    hidden: true,
    useAsTitle: 'gtin',
    defaultColumns: ['gtin', 'productUrl', 'status', 'createdAt'],
    listSearchableFields: ['gtin', 'status'],
  },
  fields: [
    {
      name: 'discovery',
      type: 'relationship',
      relationTo: 'dm-discoveries',
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
    },
  ],
}
