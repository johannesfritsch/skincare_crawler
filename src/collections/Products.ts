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
          label: 'Attributes & Claims',
          fields: [
            {
              name: 'productAttributes',
              type: 'group',
              label: 'Product Attributes',
              admin: {
                description: 'Ingredient-based attributes determined by LLM analysis of source descriptions',
              },
              fields: [
                { name: 'containsAllergens', type: 'checkbox', label: 'Contains Allergens' },
                { name: 'containsSimpleAlcohol', type: 'checkbox', label: 'Contains Simple Alcohol' },
                { name: 'containsGluten', type: 'checkbox', label: 'Contains Gluten' },
                { name: 'containsSilicones', type: 'checkbox', label: 'Contains Silicones' },
                { name: 'containsSulfates', type: 'checkbox', label: 'Contains Sulfates' },
                { name: 'containsParabens', type: 'checkbox', label: 'Contains Parabens' },
                { name: 'containsPegs', type: 'checkbox', label: 'Contains PEGs' },
                { name: 'containsFragrance', type: 'checkbox', label: 'Contains Fragrance' },
                { name: 'containsMineralOil', type: 'checkbox', label: 'Contains Mineral Oil' },
              ],
            },
            {
              name: 'productClaims',
              type: 'group',
              label: 'Product Claims',
              admin: {
                description: 'Marketing and safety claims determined by LLM analysis of source descriptions',
              },
              fields: [
                { name: 'vegan', type: 'checkbox', label: 'Vegan' },
                { name: 'crueltyFree', type: 'checkbox', label: 'Cruelty Free' },
                { name: 'unsafeForPregnancy', type: 'checkbox', label: 'Unsafe for Pregnancy' },
                { name: 'pregnancySafe', type: 'checkbox', label: 'Pregnancy Safe' },
                { name: 'waterProof', type: 'checkbox', label: 'Waterproof' },
                { name: 'microplasticFree', type: 'checkbox', label: 'Microplastic Free' },
                { name: 'allergenFree', type: 'checkbox', label: 'Allergen Free' },
                { name: 'simpleAlcoholFree', type: 'checkbox', label: 'Simple Alcohol Free' },
                { name: 'glutenFree', type: 'checkbox', label: 'Gluten Free' },
                { name: 'siliconeFree', type: 'checkbox', label: 'Silicone Free' },
                { name: 'sulfateFree', type: 'checkbox', label: 'Sulfate Free' },
                { name: 'parabenFree', type: 'checkbox', label: 'Paraben Free' },
                { name: 'pegFree', type: 'checkbox', label: 'PEG Free' },
                { name: 'fragranceFree', type: 'checkbox', label: 'Fragrance Free' },
                { name: 'mineralOilFree', type: 'checkbox', label: 'Mineral Oil Free' },
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
