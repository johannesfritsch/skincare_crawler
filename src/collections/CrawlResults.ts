import type { CollectionConfig } from 'payload'

export const CrawlResults: CollectionConfig = {
  slug: 'crawl-results',
  labels: {
    singular: 'Crawl Result',
    plural: 'Crawl Results',
  },
  admin: {
    group: 'Jobs',
    hidden: true,
  },
  fields: [
    {
      name: 'crawl',
      type: 'relationship',
      relationTo: 'product-crawls',
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
        description: 'Error message if the crawl failed for this product',
      },
    },
  ],
}
