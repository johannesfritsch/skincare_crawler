import type { CollectionConfig } from 'payload'

export const ProductVariants: CollectionConfig = {
  slug: 'product-variants',
  labels: {
    singular: 'Product Variant',
    plural: 'Product Variants',
  },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'gtin', 'product', 'createdAt'],
    listSearchableFields: ['gtin', 'label'],
    group: 'Products',
  },
  fields: [
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      label: 'Product',
      required: true,
      index: true,
    },
    {
      name: 'gtin',
      type: 'text',
      label: 'GTIN',
      unique: true,
      index: true,
      admin: {
        description: 'Global Trade Item Number for this specific variant',
      },
    },
    {
      name: 'label',
      type: 'text',
      label: 'Label',
      admin: {
        description: 'Variant-specific label (e.g. "50ml", "Rose Gold", "SPF 30")',
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Variant Image',
      admin: {
        description: 'Variant-specific product image (aggregated from source variants)',
      },
    },
    {
      name: 'sourceVariants',
      type: 'relationship',
      relationTo: 'source-variants',
      hasMany: true,
      label: 'Source Variants',
      admin: {
        description: 'Links to retailer-specific variants for this product variant',
      },
    },

  ],
}
