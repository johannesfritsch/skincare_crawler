import type { CollectionConfig } from 'payload'

export const SourceVariants: CollectionConfig = {
  slug: 'source-variants',
  labels: {
    singular: 'Source Variant',
    plural: 'Source Variants',
  },
  admin: {
    useAsTitle: 'sourceUrl',
    defaultColumns: ['sourceUrl', 'gtin', 'sourceProduct', 'variantLabel', 'createdAt'],
    listSearchableFields: ['sourceUrl', 'gtin'],
    group: 'Source Products',
    description: 'Individual purchasable variants of source products, each with a unique URL',
  },
  fields: [
    {
      name: 'sourceProduct',
      type: 'relationship',
      relationTo: 'source-products',
      label: 'Source Product',
      required: true,
      index: true,
    },
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      unique: true,
      index: true,
      admin: {
        description:
          'Variant-specific URL. For DM/Rossmann: the GTIN-based product URL. For Mueller: base URL with ?itemId= parameter.',
      },
    },
    {
      name: 'gtin',
      type: 'text',
      label: 'GTIN',
      index: true,
      admin: {
        description: 'Global Trade Item Number for this specific variant',
      },
    },
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
      name: 'sourceArticleNumber',
      type: 'text',
      label: 'Article Number',
      admin: {
        description: 'Store-specific article number / SKU for this variant (e.g., DM DAN, Mueller code, Shopify SKU)',
      },
    },
    {
      name: 'availability',
      type: 'select',
      label: 'Availability',
      defaultValue: 'unknown',
      options: [
        { label: 'Available', value: 'available' },
        { label: 'Unavailable', value: 'unavailable' },
        { label: 'Unknown', value: 'unknown' },
      ],
      admin: {
        description: 'Whether this variant is currently available for purchase at the retailer',
      },
    },
    {
      name: 'priceHistory',
      type: 'array',
      label: 'Price History',
      admin: {
        description: 'Timestamped price entries from each crawl of this variant',
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
              admin: { description: 'Reference quantity (e.g., 100 for "per 100 ml")', width: '25%' },
            },
            {
              name: 'unit',
              type: 'text',
              label: 'Unit',
              admin: { description: 'Unit of measurement (e.g., ml, g, l, kg)', width: '25%' },
            },
          ],
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
    {
      name: 'crawledAt',
      type: 'date',
      label: 'Crawled At',
      admin: {
        readOnly: true,
        description: 'When this specific variant was last crawled',
        date: { pickerAppearance: 'dayAndTime' },
      },
    },
  ],
}
