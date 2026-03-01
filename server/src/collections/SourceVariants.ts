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
