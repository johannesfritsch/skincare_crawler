import type { CollectionConfig } from 'payload'
import { SOURCE_OPTIONS } from './shared/store-fields'

export const SearchResults: CollectionConfig = {
  slug: 'search-results',
  labels: {
    singular: 'Search Result',
    plural: 'Search Results',
  },
  admin: {
    group: 'Products',
    hidden: true,
  },
  fields: [
    {
      name: 'search',
      type: 'relationship',
      relationTo: 'product-searches',
      required: true,
      index: true,
    },
    {
      name: 'sourceProduct',
      type: 'relationship',
      relationTo: 'source-products',
      required: true,
      index: true,
    },
    {
      name: 'source',
      type: 'select',
      options: [...SOURCE_OPTIONS],
      admin: {
        readOnly: true,
        description: 'Which source this result came from',
      },
    },
  ],
}
