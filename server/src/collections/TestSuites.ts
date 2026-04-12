import type { CollectionConfig } from 'payload'
import { SOURCE_OPTIONS } from './shared/store-fields'

export const TestSuites: CollectionConfig = {
  slug: 'test-suites',
  labels: {
    singular: 'Test Suite',
    plural: 'Test Suites',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
    group: 'System',
    components: {
      edit: {
        SaveButton: '@/components/TestSuiteSaveButton',
      },
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Name for this test suite (e.g. "DM Smoke Test")',
      },
    },
    {
      name: 'recentRuns',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/TestSuiteRecentRuns',
        },
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional description of what this test suite validates',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Searches',
          fields: [
            {
              name: 'searches',
              type: 'array',
              label: 'Product Searches',
              admin: {
                description: 'Product search jobs to run in the first phase',
              },
              fields: [
                {
                  name: 'query',
                  type: 'text',
                  required: true,
                  admin: { description: 'Search query text' },
                },
                {
                  name: 'sources',
                  type: 'select',
                  hasMany: true,
                  options: SOURCE_OPTIONS,
                  admin: { description: 'Stores to search (leave empty for all)' },
                },
                {
                  name: 'maxResults',
                  type: 'number',
                  defaultValue: 50,
                  admin: { description: 'Max results per source' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { description: 'JSON Schema (draft-07) to validate the job record after completion. productUrls is split into a string array (not newline-delimited). Fields: status, productUrls (string[]), completed (count), errors, etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Discoveries',
          fields: [
            {
              name: 'discoveries',
              type: 'array',
              label: 'Product Discoveries',
              admin: {
                description: 'Product discovery jobs to run in the second phase',
              },
              fields: [
                {
                  name: 'sourceUrl',
                  type: 'text',
                  required: true,
                  admin: { description: 'Category or store URL to discover products from' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { description: 'JSON Schema (draft-07) to validate the job record after completion. productUrls is split into a string array (not newline-delimited). Fields: status, productUrls (string[]), completed (count), errors, progress (JSON), etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Crawls',
          fields: [
            {
              name: 'crawls',
              type: 'array',
              label: 'Product Crawls',
              admin: {
                description: 'Product crawl jobs to run in the third phase',
              },
              fields: [
                {
                  name: 'urls',
                  type: 'textarea',
                  required: true,
                  admin: { description: 'Product URLs to crawl (one per line)' },
                },
                {
                  name: 'crawlVariants',
                  type: 'checkbox',
                  defaultValue: true,
                  admin: { description: 'Also crawl variant URLs discovered on each product page' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { description: 'JSON Schema (draft-07) to validate the source-variant record (depth=2, relations resolved). Single URL → validates the variant object. Multiple URLs → validates { variants: [...] }. Fields include: gtin, description, ingredientsText, amount, amountUnit, priceHistory, sourceProduct (resolved with name, source, categoryBreadcrumb), etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Aggregations',
          fields: [
            {
              name: 'aggregations',
              type: 'array',
              label: 'Product Aggregations',
              admin: {
                description: 'Product aggregation jobs to run in the fourth phase',
              },
              fields: [
                {
                  name: 'gtins',
                  type: 'textarea',
                  required: true,
                  admin: { description: 'GTINs to aggregate (one per line)' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { description: 'JSON Schema (draft-07) to validate the product-variant record (depth=2, relations resolved). Single GTIN → validates the variant object. Multiple GTINs → validates { variants: [...] }. Fields include: gtin, label, product (resolved with name, brand, productType, description, ingredients, etc.), images, sourceVariants, etc.' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
