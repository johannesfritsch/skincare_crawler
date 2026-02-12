import type { CollectionConfig } from 'payload'

export const SourceProducts: CollectionConfig = {
  slug: 'source-products',
  labels: {
    singular: 'Source Product',
    plural: 'Source Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'brandName', 'source', 'status', 'crawledAt', 'createdAt'],
    group: 'Content',
    description: 'Products crawled from source stores',
    listSearchableFields: ['name', 'brandName', 'gtin'],
  },
  fields: [
    {
      name: 'gtin',
      type: 'text',
      label: 'GTIN',
      index: true,
      admin: {
        description: 'Global Trade Item Number',
        position: 'sidebar',
      },
    },
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'uncrawled',
      options: [
        { label: 'Uncrawled', value: 'uncrawled' },
        { label: 'Crawled', value: 'crawled' },
        { label: 'Failed', value: 'failed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'source',
      type: 'text',
      label: 'Source',
      index: true,
      admin: {
        description: 'Source identifier (e.g., dm)',
        position: 'sidebar',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Product',
          fields: [
            {
              name: 'sourceArticleNumber',
              type: 'text',
              label: 'Article Number',
              admin: {
                description: 'Source-specific article number (e.g., DM Artikelnummer)',
              },
            },
            {
              name: 'brandName',
              type: 'text',
              label: 'Brand',
              admin: {
                description: 'Product brand name',
              },
              index: true,
            },
            {
              name: 'name',
              type: 'text',
              label: 'Product Name',
            },
            {
              name: 'type',
              type: 'text',
              label: 'Category',
              admin: {
                description: 'Product category (e.g., Make-up)',
              },
              index: true,
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'rating',
                  type: 'number',
                  label: 'Rating',
                  min: 0,
                  max: 5,
                  admin: {
                    description: 'Average rating (0-5)',
                    width: '50%',
                  },
                },
                {
                  name: 'ratingNum',
                  type: 'number',
                  label: 'Number of Reviews',
                  admin: {
                    description: 'Total number of reviews',
                    width: '50%',
                  },
                },
              ],
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
          label: 'Description',
          fields: [
            {
              name: 'description',
              type: 'textarea',
              label: 'Description',
              admin: {
                description: 'Full product description extracted from source page (markdown)',
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
          label: 'Variants',
          fields: [
            {
              name: 'variants',
              type: 'array',
              label: 'Variant Dimensions',
              fields: [
                {
                  name: 'dimension',
                  type: 'text',
                  label: 'Dimension',
                  required: true,
                },
                {
                  name: 'options',
                  type: 'array',
                  label: 'Options',
                  fields: [
                    {
                      name: 'label',
                      type: 'text',
                      label: 'Label',
                      required: true,
                    },
                    {
                      name: 'value',
                      type: 'text',
                      label: 'Value',
                    },
                    {
                      name: 'gtin',
                      type: 'text',
                      label: 'GTIN',
                    },
                    {
                      name: 'isSelected',
                      type: 'checkbox',
                      label: 'Selected',
                      defaultValue: false,
                    },
                  ],
                },
              ],
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
                description: 'Timestamped price entries from each crawl',
              },
              fields: [
                {
                  name: 'recordedAt',
                  type: 'date',
                  label: 'Recorded At',
                  required: true,
                  admin: {
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'amount',
                      type: 'number',
                      label: 'Price (cents)',
                      admin: {
                        description: 'Price in cents',
                        width: '50%',
                      },
                    },
                    {
                      name: 'currency',
                      type: 'text',
                      label: 'Currency',
                      defaultValue: 'EUR',
                      admin: {
                        width: '50%',
                      },
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
                      admin: {
                        width: '25%',
                      },
                    },
                    {
                      name: 'perUnitCurrency',
                      type: 'text',
                      label: 'Per Unit Currency',
                      defaultValue: 'EUR',
                      admin: {
                        width: '25%',
                      },
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
              ],
            },
          ],
        },
        {
          label: 'Ingredients',
          fields: [
            {
              name: 'ingredients',
              type: 'array',
              label: 'Ingredients',
              admin: {
                description: 'Raw ingredient strings as crawled from source',
              },
              fields: [
                {
                  name: 'name',
                  type: 'text',
                  required: true,
                },
              ],
            },
          ],
        },
        {
          label: 'Crawling',
          fields: [
            {
              name: 'sourceUrl',
              type: 'text',
              label: 'Source URL',
              admin: {
                description: 'URL from which this product was crawled',
              },
            },
            {
              name: 'crawledAt',
              type: 'date',
              label: 'Crawled At',
              admin: {
                description: 'When this product was last crawled',
                date: {
                  pickerAppearance: 'dayAndTime',
                },
              },
            },
          ],
        },
      ],
    },
  ],
}
