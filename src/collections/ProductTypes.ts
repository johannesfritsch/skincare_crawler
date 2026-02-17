import type { CollectionConfig } from 'payload'

export const ProductTypes: CollectionConfig = {
  slug: 'product-types',
  labels: {
    singular: 'Product Type',
    plural: 'Product Types',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'nameDE', 'slug'],
    group: 'Content',
    components: {
      beforeList: ['/components/SeedProductTypesButton'],
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Name (EN)',
    },
    {
      name: 'nameDE',
      type: 'text',
      required: true,
      label: 'Name (DE)',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
  ],
}
