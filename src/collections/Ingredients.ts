import type { CollectionConfig } from 'payload'

export const Ingredients: CollectionConfig = {
  slug: 'ingredients',
  labels: {
    singular: 'Ingredient',
    plural: 'Ingredients',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'createdAt'],
    group: 'Content',
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
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'placeholder',
      options: [
        { label: 'Placeholder', value: 'placeholder' },
        { label: 'Crawled', value: 'crawled' },
      ],
      admin: {
        description: 'Placeholder ingredients are auto-created and need enrichment',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
      admin: {
        condition: (data) => data?.status === 'crawled',
      },
    },
  ],
}
