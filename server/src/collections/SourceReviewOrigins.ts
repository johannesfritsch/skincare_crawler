import type { CollectionConfig } from 'payload'
import { SOURCE_OPTIONS } from './shared/store-fields'

export const SourceReviewOrigins: CollectionConfig = {
  slug: 'source-review-origins',
  labels: {
    singular: 'Source Review Origin',
    plural: 'Source Review Origins',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'source', 'incentivized', 'createdAt'],
    group: 'Source Products',
    description: 'Syndication sources for reviews (e.g. Home Tester Club, The Insiders)',
    listSearchableFields: ['name'],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Syndication source name (e.g. "Home Tester Club")',
      },
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      index: true,
      options: [...SOURCE_OPTIONS],
      admin: {
        description: 'Store this origin was discovered in',
      },
    },
    {
      name: 'incentivized',
      type: 'checkbox',
      admin: {
        description: 'Whether this origin incentivizes reviews (e.g. product testing panels)',
      },
    },
    {
      name: 'reasoning',
      type: 'textarea',
      admin: {
        description: 'LLM reasoning for the incentivized classification',
      },
    },
  ],
}
