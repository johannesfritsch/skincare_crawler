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
    defaultColumns: ['name', 'recentRunStatus', 'createdAt'],
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
      name: 'recentRunStatus',
      type: 'ui',
      admin: {
        components: {
          Cell: '@/components/TestSuiteRunsCell',
        },
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
      name: 'maxAge',
      type: 'number',
      defaultValue: 0,
      min: 0,
      admin: {
        description: 'Reuse existing data if it was fetched within this many minutes. 0 = always re-fetch (default). E.g. 60 = reuse searches/crawls/aggregations completed in the last hour.',
        width: '50%',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Product Searches',
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
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the job record after completion. productUrls is split into a string array (not newline-delimited). Fields: status, productUrls (string[]), completed (count), errors, etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Product Discoveries',
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
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the job record after completion. productUrls is split into a string array (not newline-delimited). Fields: status, productUrls (string[]), completed (count), errors, progress (JSON), etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Product Crawls',
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
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the source-variant record (depth=2, relations resolved). Single URL → validates the variant object. Multiple URLs → validates { variants: [...] }. Fields include: gtin, description, ingredientsText, amount, amountUnit, priceHistory, sourceProduct (resolved with name, source, categoryBreadcrumb), etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Product Aggregations',
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
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the product-variant record (depth=2, relations resolved). Single GTIN → validates the variant object. Multiple GTINs → validates { variants: [...] }. Fields include: gtin, label, product (resolved with name, brand, productType, description, ingredients, etc.), images, sourceVariants, etc.' },
                },
                {
                  name: 'aiChecks',
                  type: 'array',
                  label: 'AI Quality Checks',
                  admin: {
                    description: 'Natural-language yes/no questions evaluated by an LLM against the aggregated product data. Each question produces a boolean answer with reasoning.',
                  },
                  fields: [
                    {
                      name: 'question',
                      type: 'text',
                      required: true,
                      admin: {
                        description: 'A yes/no question (e.g. "Does the product have a meaningful description of at least 50 characters?")',
                      },
                    },
                  ],
                },
                {
                  name: 'aiCheckThreshold',
                  type: 'number',
                  defaultValue: 0.75,
                  min: 0,
                  max: 1,
                  admin: {
                    description: 'Minimum score (0-1) for AI checks to pass. Score = questions answered "yes" / total questions. Default: 0.75',
                    step: 0.05,
                    width: '50%',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Video Discoveries',
          fields: [
            {
              name: 'videoDiscoveries',
              type: 'array',
              label: 'Video Discoveries',
              admin: {
                description: 'Video discovery jobs to run — discovers videos from YouTube channels',
              },
              fields: [
                {
                  name: 'channelUrl',
                  type: 'text',
                  required: true,
                  admin: { description: 'YouTube channel URL to discover videos from' },
                },
                {
                  name: 'maxVideos',
                  type: 'number',
                  admin: { description: 'Maximum videos to discover (empty = unlimited)' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the job record after completion. videoUrls is split into a string array. Fields: status, videoUrls (string[]), completed (count), errors, etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Video Crawls',
          fields: [
            {
              name: 'videoCrawls',
              type: 'array',
              label: 'Video Crawls',
              admin: {
                description: 'Video crawl jobs — downloads video metadata, MP4, and thumbnails',
              },
              fields: [
                {
                  name: 'urls',
                  type: 'textarea',
                  required: true,
                  admin: { description: 'Video URLs to crawl (one per line)' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the video record (depth=2, relations resolved). Single URL → validates the video object. Multiple URLs → validates { videos: [...] }. Fields include: title, externalUrl, duration, viewCount, status, channel (resolved), videoFile, thumbnail, videoScenes (join), etc.' },
                },
              ],
            },
          ],
        },
        {
          label: 'Video Processing',
          fields: [
            {
              name: 'videoProcessings',
              type: 'array',
              label: 'Video Processing',
              admin: {
                description: 'Video processing jobs — scene detection, barcode scan, transcription, sentiment analysis',
              },
              fields: [
                {
                  name: 'urls',
                  type: 'textarea',
                  required: true,
                  admin: { description: 'Video URLs to process (one per line)' },
                },
                {
                  name: 'checkSchema',
                  type: 'json',
                  admin: { components: { Field: '@/components/CheckSchemaField' }, description: 'JSON Schema (draft-07) to validate the video record (depth=2, relations resolved). Single URL → validates the video object. Multiple URLs → validates { videos: [...] }. Fields include: title, status, videoScenes (array with transcript, barcodes, objects, recognitions, detections), channel, etc.' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
