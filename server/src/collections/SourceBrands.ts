import type { CollectionConfig } from 'payload'
import { SOURCE_OPTIONS } from './shared/store-fields'

export const SourceBrands: CollectionConfig = {
  slug: 'source-brands',
  labels: {
    singular: 'Source Brand',
    plural: 'Source Brands',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'source', 'sourceUrl', 'createdAt'],
    group: 'Products',
    description: 'Brands discovered from source stores',
    listSearchableFields: ['name'],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Brand Name',
      index: true,
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      label: 'Source',
      index: true,
      options: [...SOURCE_OPTIONS],
    },
    {
      name: 'sourceUrl',
      type: 'text',
      unique: true,
      index: true,
      label: 'Brand Page URL',
      admin: {
        description: 'The brand page URL on the source store (dedup key)',
      },
    },
    {
      name: 'imageUrl',
      type: 'text',
      label: 'Brand Image URL',
      admin: {
        description: 'Brand logo/image URL from the source store',
      },
    },
  ],
}
