import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: 'Product',
    plural: 'Products',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'brand', 'productType', 'createdAt'],
    listSearchableFields: ['name'],
    group: 'Products',
    components: {
      edit: {
        SaveButton: '@/components/ProductSaveButton',
      },
      listMenuItems: ['@/components/bulk-actions/ProductBulkActions'],
      beforeListTable: ['@/components/bulk-actions/ProductBulkStatus'],
    },
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
              name: 'productType',
              type: 'relationship',
              relationTo: 'product-types',
              label: 'Product Type',
            },
            {
              name: 'image',
              type: 'upload',
              relationTo: 'media',
              label: 'Product Image',
              admin: {
                description: 'Primary product image (aggregated from source products)',
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
        },
        {
          label: 'Variants',
          fields: [
            {
              name: 'variants',
              type: 'join',
              collection: 'product-variants',
              on: 'product',
              admin: {
                defaultColumns: ['label', 'gtin', 'isDefault'],
                description: 'Product variants, each with their own GTIN and retailer source links',
              },
            },
          ],
        },
        {
          label: 'Details',
          fields: [
            {
              name: 'warnings',
              type: 'textarea',
              label: 'Warnings',
              admin: {
                description: 'Product warnings extracted from descriptions (e.g. "Avoid contact with eyes")',
              },
            },
            {
              name: 'skinApplicability',
              type: 'select',
              label: 'Skin Applicability',
              options: [
                { label: 'Normal', value: 'normal' },
                { label: 'Sensitive', value: 'sensitive' },
                { label: 'Mixed', value: 'mixed' },
                { label: 'Oily', value: 'oily' },
                { label: 'Dry', value: 'dry' },
              ],
              admin: {
                description: 'Target skin type as stated in the product description',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'phMin',
                  type: 'number',
                  label: 'pH Min',
                  min: 0,
                  max: 14,
                  admin: {
                    width: '50%',
                    description: 'Minimum pH level (0–14)',
                    step: 0.1,
                  },
                },
                {
                  name: 'phMax',
                  type: 'number',
                  label: 'pH Max',
                  min: 0,
                  max: 14,
                  admin: {
                    width: '50%',
                    description: 'Maximum pH level (0–14)',
                    step: 0.1,
                  },
                },
              ],
            },
            {
              name: 'usageInstructions',
              type: 'textarea',
              label: 'Usage Instructions',
              admin: {
                description: 'How to use the product, extracted from descriptions',
              },
            },
            {
              name: 'usageSchedule',
              type: 'json',
              label: 'Usage Schedule',
              admin: {
                description:
                  'A 2D array: outer = repeating day cycle, inner = up to 3 time slots [morning, midday, evening]. ' +
                  'Each slot is 1 (use) or 0 (skip). An empty inner array [] means skip that day entirely. ' +
                  'Example: [[1,0,1]] = daily morning+evening. [[1,0,0],[]] = every other day morning only.',
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
              type: 'array',
              label: 'Product Attributes',
              admin: {
                description: 'Ingredient-based attributes with evidence from source products',
              },
              fields: [
                {
                  name: 'attribute',
                  type: 'select',
                  label: 'Attribute',
                  required: true,
                  options: [
                    { label: 'Contains Allergens', value: 'containsAllergens' },
                    { label: 'Contains Simple Alcohol', value: 'containsSimpleAlcohol' },
                    { label: 'Contains Gluten', value: 'containsGluten' },
                    { label: 'Contains Silicones', value: 'containsSilicones' },
                    { label: 'Contains Sulfates', value: 'containsSulfates' },
                    { label: 'Contains Parabens', value: 'containsParabens' },
                    { label: 'Contains PEGs', value: 'containsPegs' },
                    { label: 'Contains Fragrance', value: 'containsFragrance' },
                    { label: 'Contains Mineral Oil', value: 'containsMineralOil' },
                  ],
                },
                {
                  name: 'sourceProduct',
                  type: 'relationship',
                  relationTo: 'source-products',
                  label: 'Source Product',
                  required: true,
                },
                {
                  name: 'evidenceType',
                  type: 'select',
                  label: 'Evidence Type',
                  required: true,
                  options: [
                    { label: 'Ingredient', value: 'ingredient' },
                    { label: 'Description Snippet', value: 'descriptionSnippet' },
                  ],
                },
                {
                  name: 'snippet',
                  type: 'text',
                  label: 'Description Snippet',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'descriptionSnippet',
                  },
                },
                {
                  name: 'start',
                  type: 'number',
                  label: 'Start Position',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'descriptionSnippet',
                  },
                },
                {
                  name: 'end',
                  type: 'number',
                  label: 'End Position',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'descriptionSnippet',
                  },
                },
                {
                  name: 'ingredientNames',
                  type: 'array',
                  label: 'Ingredient Names',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'ingredient',
                  },
                  fields: [
                    { name: 'name', type: 'text', label: 'Name', required: true },
                  ],
                },
              ],
            },
            {
              name: 'productClaims',
              type: 'array',
              label: 'Product Claims',
              admin: {
                description: 'Marketing and safety claims with evidence from source products',
              },
              fields: [
                {
                  name: 'claim',
                  type: 'select',
                  label: 'Claim',
                  required: true,
                  options: [
                    { label: 'Vegan', value: 'vegan' },
                    { label: 'Cruelty Free', value: 'crueltyFree' },
                    { label: 'Unsafe for Pregnancy', value: 'unsafeForPregnancy' },
                    { label: 'Pregnancy Safe', value: 'pregnancySafe' },
                    { label: 'Waterproof', value: 'waterProof' },
                    { label: 'Microplastic Free', value: 'microplasticFree' },
                    { label: 'Allergen Free', value: 'allergenFree' },
                    { label: 'Simple Alcohol Free', value: 'simpleAlcoholFree' },
                    { label: 'Gluten Free', value: 'glutenFree' },
                    { label: 'Silicone Free', value: 'siliconeFree' },
                    { label: 'Sulfate Free', value: 'sulfateFree' },
                    { label: 'Paraben Free', value: 'parabenFree' },
                    { label: 'PEG Free', value: 'pegFree' },
                    { label: 'Fragrance Free', value: 'fragranceFree' },
                    { label: 'Mineral Oil Free', value: 'mineralOilFree' },
                  ],
                },
                {
                  name: 'sourceProduct',
                  type: 'relationship',
                  relationTo: 'source-products',
                  label: 'Source Product',
                  required: true,
                },
                {
                  name: 'evidenceType',
                  type: 'select',
                  label: 'Evidence Type',
                  required: true,
                  options: [
                    { label: 'Ingredient', value: 'ingredient' },
                    { label: 'Description Snippet', value: 'descriptionSnippet' },
                  ],
                },
                {
                  name: 'snippet',
                  type: 'text',
                  label: 'Description Snippet',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'descriptionSnippet',
                  },
                },
                {
                  name: 'start',
                  type: 'number',
                  label: 'Start Position',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'descriptionSnippet',
                  },
                },
                {
                  name: 'end',
                  type: 'number',
                  label: 'End Position',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'descriptionSnippet',
                  },
                },
                {
                  name: 'ingredientNames',
                  type: 'array',
                  label: 'Ingredient Names',
                  admin: {
                    condition: (_data, siblingData) => siblingData?.evidenceType === 'ingredient',
                  },
                  fields: [
                    { name: 'name', type: 'text', label: 'Name', required: true },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'In Videos',
          fields: [
            {
              name: 'videoSnippets',
              type: 'join',
              collection: 'video-snippets',
              on: 'referencedProducts',
            },
            {
              name: 'videoMentions',
              type: 'join',
              collection: 'video-mentions',
              on: 'product',
              admin: {
                defaultColumns: ['videoSnippet', 'overallSentiment', 'overallSentimentScore'],
              },
            },
          ],
        },
        {
          label: 'Scoring',
          fields: [
            {
              name: 'scoreHistory',
              type: 'array',
              label: 'Score History',
              admin: {
                description: 'Timestamped snapshots of store and creator scores, recorded during each aggregation run',
              },
              fields: [
                {
                  name: 'recordedAt',
                  type: 'date',
                  label: 'Recorded At',
                  required: true,
                  admin: { date: { pickerAppearance: 'dayAndTime' } },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'storeScore',
                      type: 'number',
                      label: 'Store Score (0–10)',
                      min: 0,
                      max: 10,
                      admin: { step: 0.1, width: '33%' },
                    },
                    {
                      name: 'creatorScore',
                      type: 'number',
                      label: 'Creator Score (0–10)',
                      min: 0,
                      max: 10,
                      admin: { step: 0.1, width: '33%' },
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
                      admin: {
                        width: '33%',
                        description: 'Score movement vs previous record (>= 5% relative change)',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'Aggregations',
          fields: [
            {
              name: 'aggregations',
              type: 'join',
              collection: 'product-aggregations',
              on: 'products',
              admin: { allowCreate: false },
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
                description: 'When data sources were last aggregated into name, brand, and description',
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
