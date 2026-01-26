import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: 'Product',
    plural: 'Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'gtin', 'brand', 'category', 'createdAt'],
    group: 'Content',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Product Name',
      validate: (value: string | null | undefined, { siblingData }: { siblingData: Record<string, unknown> }) => {
        if (siblingData?.publishedAt && !value) {
          return 'Name is required for published products'
        }
        return true
      },
    },
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
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
    {
      name: 'brand',
      type: 'relationship',
      relationTo: 'brands',
      label: 'Brand',
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      label: 'Category',
    },
    {
      name: 'dmProduct',
      type: 'relationship',
      relationTo: 'dm-products',
      label: 'DM Product',
      admin: {
        description: 'Link to crawled DM product data',
      },
    },
    {
      name: 'lastAggregatedAt',
      type: 'date',
      label: 'Last Aggregated At',
      admin: {
        description: 'When data sources were last aggregated into name, category, and description',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Published At',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
  ],
}
