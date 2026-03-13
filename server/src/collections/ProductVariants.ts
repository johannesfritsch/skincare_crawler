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
      name: 'sourceVariants',
      type: 'relationship',
      relationTo: 'source-variants',
      hasMany: true,
      label: 'Source Variants',
      admin: {
        description: 'Links to retailer-specific variants for this product variant',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Variant',
          fields: [
            {
              name: 'description',
              type: 'textarea',
              label: 'Description',
              admin: {
                description: 'Aggregated description (LLM consensus from source variants)',
              },
            },
            {
              name: 'images',
              type: 'array',
              label: 'Variant Images',
              admin: {
                description: 'Variant images (first entry is primary display image, aggregated from source variants by source priority)',
              },
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'media',
                  label: 'Image',
                  required: true,
                },
              ],
            },
            {
              name: 'recognitionImages',
              type: 'array',
              label: 'Recognition Images',
              admin: {
                description: 'Cropped product packaging regions detected by Grounding DINO object detection',
              },
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'media',
                  label: 'Cropped Image',
                  required: true,
                },
                {
                  name: 'score',
                  type: 'number',
                  label: 'Detection Score',
                  min: 0,
                  max: 1,
                  admin: {
                    description: 'Object detection confidence (0-1)',
                    step: 0.001,
                  },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'boxXMin',
                      type: 'number',
                      label: 'X Min',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'boxYMin',
                      type: 'number',
                      label: 'Y Min',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'boxXMax',
                      type: 'number',
                      label: 'X Max',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'boxYMax',
                      type: 'number',
                      label: 'Y Max',
                      admin: { width: '25%' },
                    },
                  ],
                },
                {
                  name: 'hasEmbedding',
                  type: 'checkbox',
                  label: 'Has Embedding',
                  defaultValue: false,
                  admin: {
                    readOnly: true,
                    description: 'Whether a CLIP embedding vector has been computed for this crop.',
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
                    width: '33%',
                    description: 'Product amount (e.g. 100, 250)',
                  },
                },
                {
                  name: 'amountUnit',
                  type: 'text',
                  label: 'Unit',
                  admin: {
                    width: '33%',
                    description: 'Unit of measurement (e.g. ml, g)',
                  },
                },
                {
                  name: 'variantDimension',
                  type: 'text',
                  label: 'Dimension',
                  admin: {
                    width: '33%',
                    description: 'Variant dimension type (e.g. "Color", "Size")',
                  },
                },
              ],
            },
            {
              name: 'labels',
              type: 'array',
              label: 'Labels',
              admin: {
                description: 'Deduplicated labels from source variants (LLM-normalized to canonical German, store-specific labels removed)',
              },
              fields: [
                { name: 'label', type: 'text', label: 'Label', required: true },
              ],
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
                description: 'Product ingredients (parsed from source variant INCI text, matched to ingredient database)',
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
      ],
    },
  ],
}
