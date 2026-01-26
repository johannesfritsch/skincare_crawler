import type { CollectionConfig } from 'payload'

export const DmProducts: CollectionConfig = {
  slug: 'dm-products',
  labels: {
    singular: 'DM Product',
    plural: 'DM Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'brandName', 'pricing.amount', 'rating', 'createdAt'],
    group: 'DM Data',
    description: 'Products crawled from dm.de',
    listSearchableFields: ['name', 'brandName', 'gtin'],
  },
  fields: [
    {
      name: 'gtin',
      type: 'text',
      label: 'GTIN',
      admin: {
        description: 'Global Trade Item Number',
      },
      index: true,
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
      required: true,
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
      name: 'pricing',
      type: 'group',
      label: 'Pricing',
      admin: {
        description: 'Product pricing information',
      },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'amount',
              type: 'number',
              label: 'Price (cents)',
              admin: {
                description: 'Price in smallest currency unit (cents)',
                width: '50%',
              },
            },
            {
              name: 'currency',
              type: 'text',
              label: 'Currency',
              defaultValue: 'EUR',
              admin: {
                description: 'ISO 4217 currency code',
                width: '50%',
              },
            },
          ],
        },
        {
          type: 'collapsible',
          label: 'Price per Unit',
          admin: {
            initCollapsed: true,
          },
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'perUnitAmount',
                  type: 'number',
                  label: 'Per Unit Price (cents)',
                  admin: {
                    description: 'Base price per unit in cents',
                    width: '33%',
                  },
                },
                {
                  name: 'perUnitCurrency',
                  type: 'text',
                  label: 'Currency',
                  defaultValue: 'EUR',
                  admin: {
                    width: '33%',
                  },
                },
                {
                  name: 'unit',
                  type: 'text',
                  label: 'Unit',
                  admin: {
                    description: 'Unit of measurement (e.g., l, kg)',
                    width: '33%',
                  },
                },
              ],
            },
          ],
        },
      ],
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
}
