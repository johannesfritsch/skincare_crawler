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
              type: 'array',
              label: 'Ingredients',
              admin: {
                description: 'Product ingredients (aggregated from sources)',
              },
              fields: [
                {
                  name: 'name',
                  type: 'text',
                  label: 'Name',
                  required: true,
                  admin: { description: 'Raw ingredient name as listed on the product' },
                },
                {
                  name: 'ingredient',
                  type: 'relationship',
                  relationTo: 'ingredients',
                  label: 'Matched Ingredient',
                  admin: { description: 'Link to ingredient database entry, if matched' },
                },
              ],
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
              name: 'sourceProducts',
              type: 'relationship',
              relationTo: 'source-products',
              hasMany: true,
              label: 'Source Products',
              admin: {
                description: 'Links to crawled source product data',
              },
            },
          ],
        },
      ],
    },
  ],
}
