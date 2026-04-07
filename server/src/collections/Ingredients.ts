import type { CollectionConfig } from 'payload'
import { INGREDIENT_FIELDS } from '@anyskin/shared'

/**
 * Select options for the fieldsProvided select field, derived from the shared
 * INGREDIENT_FIELDS constant. Labels are human-readable versions of field names.
 */
const INGREDIENT_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  casNumber: 'CAS Number',
  ecNumber: 'EC Number',
  cosIngId: 'CosIng ID',
  chemicalDescription: 'Chemical Description',
  functions: 'Functions',
  itemType: 'Item Type',
  restrictions: 'Restrictions',
  longDescription: 'Long Description',
  shortDescription: 'Short Description',
  image: 'Image',
}

const INGREDIENT_FIELD_OPTIONS = INGREDIENT_FIELDS.map((value) => ({
  label: INGREDIENT_FIELD_LABELS[value] ?? value,
  value,
}))

export const Ingredients: CollectionConfig = {
  slug: 'ingredients',
  labels: {
    singular: 'Ingredient',
    plural: 'Ingredients',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'crawledAt', 'createdAt'],
    group: 'Products',
    components: {
      edit: {
        SaveButton: '@/components/IngredientSaveButton',
      },
      listMenuItems: ['@/components/bulk-actions/IngredientBulkActions'],
      beforeListTable: ['@/components/bulk-actions/IngredientBulkStatus'],
    },
  },
  fields: [
    {
      name: 'crawlStatus',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/IngredientJobStatus',
        },
      },
    },
    {
      name: 'name',
      type: 'text',
      label: 'Ingredient Name',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'ingredient-media',
      label: 'Image',
      admin: {
        description: 'Molecular structure or visual reference for this ingredient',
      },
    },
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'uncrawled',
      options: [
        { label: 'Crawled', value: 'crawled' },
        { label: 'Uncrawled', value: 'uncrawled' },
      ],
      index: true,
    },
    {
      name: 'shortDescription',
      type: 'textarea',
      label: 'Short Description',
      admin: {
        description: 'LLM-generated concise but entertaining summary of the ingredient',
      },
    },
    {
      name: 'longDescription',
      type: 'textarea',
      label: 'Long Description',
      admin: {
        description: 'Detailed ingredient description extracted from INCIDecoder',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
      admin: {
        description: 'Legacy description field (from CosIng)',
      },
    },
    {
      name: 'casNumber',
      type: 'text',
      label: 'CAS Number',
      index: true,
    },
    {
      name: 'ecNumber',
      type: 'text',
      label: 'EC Number',
      index: true,
    },
    {
      name: 'cosIngId',
      type: 'text',
      label: 'CosIng ID',
      index: true,
      admin: {
        description: 'Substance ID from CosIng database',
      },
    },
    {
      name: 'chemicalDescription',
      type: 'textarea',
      label: 'Chemical Description',
    },
    {
      name: 'functions',
      type: 'array',
      label: 'Functions',
      fields: [
        {
          name: 'function',
          type: 'text',
        },
      ],
    },
    {
      name: 'itemType',
      type: 'select',
      label: 'Item Type',
      options: [
        { label: 'Ingredient', value: 'ingredient' },
        { label: 'Substance', value: 'substance' },
      ],
    },
    {
      name: 'restrictions',
      type: 'textarea',
      label: 'Restrictions',
    },
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      admin: {
        description: 'Legacy field (CosIng page URL). Use sources array instead.',
      },
    },
    {
      name: 'sources',
      type: 'array',
      label: 'Sources',
      admin: {
        description: 'Data sources for this ingredient (CosIng, INCIDecoder, etc.)',
      },
      fields: [
        {
          name: 'source',
          type: 'select',
          required: true,
          options: [
            { label: 'CosIng', value: 'cosing' },
            { label: 'INCIDecoder', value: 'incidecoder' },
          ],
        },
        {
          name: 'sourceUrl',
          type: 'text',
          label: 'Source URL',
        },
        {
          name: 'fieldsProvided',
          type: 'select',
          hasMany: true,
          label: 'Fields Provided',
          options: [...INGREDIENT_FIELD_OPTIONS],
          admin: {
            description: 'Which ingredient fields were populated by this source',
          },
        },
      ],
    },
    {
      name: 'crawledAt',
      type: 'date',
      label: 'Last Crawled At',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
  ],
}
