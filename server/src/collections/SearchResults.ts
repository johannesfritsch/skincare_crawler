import type { CollectionConfig } from 'payload'
import { SOURCE_OPTIONS } from './shared/store-fields'

export const SearchResults: CollectionConfig = {
  slug: 'search-results',
  labels: {
    singular: 'Search Result',
    plural: 'Search Results',
  },
  admin: {
    useAsTitle: 'matchedQuery',
    defaultColumns: ['matchedQuery', 'sourceProduct', 'source'],
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
      name: 'matchedQuery',
      type: 'text',
      label: 'Matched Query',
      admin: {
        readOnly: true,
        description: 'The individual query line (e.g. a single GTIN) that produced this result',
      },
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
