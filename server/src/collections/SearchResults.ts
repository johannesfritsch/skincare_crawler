import type { CollectionConfig } from 'payload'

export const SearchResults: CollectionConfig = {
  slug: 'search-results',
  labels: {
    singular: 'Search Result',
    plural: 'Search Results',
  },
  admin: {
    group: 'Jobs',
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
      options: [
        { label: 'dm', value: 'dm' },
        { label: 'Müller', value: 'mueller' },
        { label: 'Rossmann', value: 'rossmann' },
      ],
      admin: {
        readOnly: true,
        description: 'Which source this result came from',
      },
    },
  ],
}
