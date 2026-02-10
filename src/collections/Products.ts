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
      type: 'tabs',
      tabs: [
        {
          label: 'Product',
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
              unique: true,
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
        },
        {
          label: 'Ingredients',
          fields: [
            {
              name: 'ingredients',
              type: 'relationship',
              relationTo: 'ingredients',
              hasMany: true,
              label: 'Ingredients',
              admin: {
                description: 'Product ingredients (aggregated from sources)',
              },
            },
          ],
        },
        {
          label: 'Sources',
          fields: [
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
              name: 'aggregationStatus',
              type: 'select',
              label: 'Aggregation Status',
              options: [
                { label: 'Pending', value: 'pending' },
                { label: 'Success', value: 'success' },
                { label: 'Brand Matching Error', value: 'brand_matching_error' },
                { label: 'Category Matching Error', value: 'category_matching_error' },
                { label: 'Ingredient Matching Error', value: 'ingredient_matching_error' },
                { label: 'Failed', value: 'failed' },
              ],
              admin: {
                readOnly: true,
              },
            },
            {
              name: 'aggregationErrors',
              type: 'textarea',
              label: 'Aggregation Errors',
              admin: {
                readOnly: true,
                condition: (_data, siblingData) => siblingData?.aggregationStatus !== 'success',
              },
            },
            {
              name: 'sourceProduct',
              type: 'relationship',
              relationTo: 'source-products',
              label: 'Source Product',
              admin: {
                description: 'Link to crawled source product data',
              },
            },
          ],
        },
      ],
    },
  ],
}
