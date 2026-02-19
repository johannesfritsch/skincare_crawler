import type { CollectionConfig } from 'payload'

export const DiscoveryResults: CollectionConfig = {
  slug: 'discovery-results',
  labels: {
    singular: 'Discovery Result',
    plural: 'Discovery Results',
  },
  admin: {
    group: 'Jobs',
    hidden: true,
  },
  fields: [
    {
      name: 'discovery',
      type: 'relationship',
      relationTo: 'product-discoveries',
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
      name: 'error',
      type: 'text',
      label: 'Error',
      admin: {
        readOnly: true,
        description: 'Error message if this URL failed during discovery',
      },
    },
  ],
}
