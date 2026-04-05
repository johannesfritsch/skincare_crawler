import type { CollectionConfig } from 'payload'

export const Brands: CollectionConfig = {
  slug: 'brands',
  labels: {
    singular: 'Brand',
    plural: 'Brands',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'image', 'createdAt'],
    group: 'Products',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Brand Name',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'brand-media',
      label: 'Brand Image',
      admin: {
        description: 'Brand logo or image, downloaded from source stores during aggregation.',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: 'Description',
    },
  ],
}
