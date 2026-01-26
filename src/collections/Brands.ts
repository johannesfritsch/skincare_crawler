import type { CollectionConfig } from 'payload'

export const Brands: CollectionConfig = {
  slug: 'brands',
  labels: {
    singular: 'Brand',
    plural: 'Brands',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
    group: 'Content',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Brand Name',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
  ],
}
