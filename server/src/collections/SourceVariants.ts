import type { CollectionConfig } from 'payload'

export const SourceVariants: CollectionConfig = {
  slug: 'source-variants',
  labels: {
    singular: 'Source Variant',
    plural: 'Source Variants',
  },
  admin: {
    useAsTitle: 'sourceUrl',
    defaultColumns: ['sourceUrl', 'gtin', 'pzn', 'sourceProduct', 'variantLabel', 'createdAt'],
    listSearchableFields: ['sourceUrl', 'gtin'],
    group: 'Source Products',
    description: 'Individual purchasable variants of source products, each with a unique URL',
  },
  hooks: {},
  fields: [
    // ── Sidebar ──
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'Variant-specific URL. For DM/Rossmann: the GTIN-based product URL. For Mueller: base URL with ?itemId= parameter.',
        components: {
          Field: '@/components/SourceUrlField',
          Cell: '@/components/SourceUrlCell',
        },
      },
    },
    {
      name: 'sourceProduct',
      type: 'relationship',
      relationTo: 'source-products',
      label: 'Source Product',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'gtin',
      type: 'text',
      label: 'GTIN',
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Global Trade Item Number for this specific variant',
      },
    },
    {
      name: 'pzn',
      type: 'text',
      label: 'PZN',
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Pharmazentralnummer (German pharmacy product number)',
      },
    },
    {
      name: 'sourceArticleNumber',
      type: 'text',
      label: 'Article Number',
      admin: {
        position: 'sidebar',
        description:
          'Store-specific article number / SKU (e.g., DM DAN, Mueller code, Shopify SKU)',
      },
    },
    {
      name: 'crawledAt',
      type: 'date',
      label: 'Crawled At',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'When this specific variant was last crawled',
        date: { pickerAppearance: 'dayAndTime' },
      },
    },

    // ── Tabs ──
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Variant',
          fields: [
            {
              name: 'variantLabel',
              type: 'text',
              label: 'Variant Label',
              admin: {
                description: 'Human-readable label (e.g. "Shade 420 - Nude Rose", "50ml")',
              },
            },
            {
              name: 'variantDimension',
              type: 'text',
              label: 'Variant Dimension',
              admin: {
                description: 'The dimension this variant represents (e.g. "Color", "Size")',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'amount',
                  type: 'number',
                  label: 'Amount',
                  admin: {
                    description: 'Product amount (e.g., 3, 100, 250)',
                    width: '50%',
                  },
                },
                {
                  name: 'amountUnit',
                  type: 'text',
                  label: 'Unit',
                  admin: {
                    description: 'Unit of measurement (e.g., ml, g, Stück)',
                    width: '50%',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Description',
          fields: [
            {
              name: 'description',
              type: 'textarea',
              label: 'Description',
              admin: {
                description: 'Full product description extracted from the variant page (markdown)',
              },
            },
          ],
        },
        {
          label: 'Images',
          fields: [
            {
              name: 'images',
              type: 'array',
              label: 'Images',
              fields: [
                {
                  name: 'url',
                  type: 'text',
                  label: 'URL',
                  required: true,
                },
                {
                  name: 'alt',
                  type: 'text',
                  label: 'Alt Text',
                },
              ],
            },
          ],
        },
        {
          label: 'Ingredients',
          fields: [
            {
              name: 'ingredientsText',
              type: 'textarea',
              label: 'Ingredients Text',
              admin: {
                description: 'Raw INCI ingredients text as crawled from the variant page',
              },
            },
          ],
        },
        {
          label: 'Labels',
          fields: [
            {
              name: 'labels',
              type: 'array',
              label: 'Labels',
              admin: {
                description: 'Product labels (e.g., Neu, Limitiert, dm-Marke)',
              },
              fields: [
                {
                  name: 'label',
                  type: 'text',
                  required: true,
                },
              ],
            },
          ],
        },
        {
          label: 'Reviews',
          fields: [
            {
              name: 'sourceReviews',
              type: 'join',
              collection: 'source-reviews',
              on: 'sourceVariants',
              admin: {
                defaultColumns: ['rating', 'title', 'userNickname', 'submittedAt'],
              },
            },
          ],
        },
        {
          label: 'Price History',
          fields: [
            {
              name: 'priceHistory',
              type: 'array',
              label: 'Price History',
              admin: {
                description:
                  'Timestamped price & availability entries from each crawl of this variant',
              },
              fields: [
                {
                  name: 'recordedAt',
                  type: 'date',
                  label: 'Recorded At',
                  required: true,
                  admin: {
                    date: { pickerAppearance: 'dayAndTime' },
                  },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'amount',
                      type: 'number',
                      label: 'Price (cents)',
                      admin: { description: 'Price in cents', width: '50%' },
                    },
                    {
                      name: 'currency',
                      type: 'text',
                      label: 'Currency',
                      defaultValue: 'EUR',
                      admin: { width: '50%' },
                    },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'perUnitAmount',
                      type: 'number',
                      label: 'Per Unit Price (cents)',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'perUnitCurrency',
                      type: 'text',
                      label: 'Per Unit Currency',
                      defaultValue: 'EUR',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'perUnitQuantity',
                      type: 'number',
                      label: 'Per Unit Qty',
                      admin: {
                        description: 'Reference quantity (e.g., 100 for "per 100 ml")',
                        width: '25%',
                      },
                    },
                    {
                      name: 'unit',
                      type: 'text',
                      label: 'Unit',
                      admin: {
                        description: 'Unit of measurement (e.g., ml, g, l, kg)',
                        width: '25%',
                      },
                    },
                  ],
                },
                {
                  name: 'availability',
                  type: 'select',
                  label: 'Availability',
                  options: [
                    { label: 'Available', value: 'available' },
                    { label: 'Unavailable', value: 'unavailable' },
                    { label: 'Unknown', value: 'unknown' },
                  ],
                  admin: { description: 'Whether this variant was available at crawl time' },
                },
                {
                  name: 'change',
                  type: 'select',
                  label: 'Change',
                  options: [
                    { label: 'Drop', value: 'drop' },
                    { label: 'Stable', value: 'stable' },
                    { label: 'Increase', value: 'increase' },
                  ],
                  admin: { description: 'Price movement vs previous record' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
