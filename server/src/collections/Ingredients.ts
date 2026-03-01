import type { CollectionConfig } from 'payload'

export const Ingredients: CollectionConfig = {
  slug: 'ingredients',
  labels: {
    singular: 'Ingredient',
    plural: 'Ingredients',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'crawledAt', 'createdAt'],
    group: 'Ingredients',
    components: {
      edit: {
        SaveButton: '@/components/IngredientSaveButton',
      },
    },
  },
  fields: [
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
      relationTo: 'media',
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
        description: 'CosIng page URL',
      },
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
