import type { CollectionConfig } from 'payload'

export const SourceCategories: CollectionConfig = {
  slug: 'source-categories',
  labels: {
    singular: 'Source Category',
    plural: 'Source Categories',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'source', 'parent', 'createdAt'],
    group: 'Content',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Name',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      label: 'Slug',
      required: true,
      index: true,
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'source-categories',
      label: 'Parent',
    },
    {
      name: 'source',
      type: 'select',
      label: 'Source',
      required: true,
      index: true,
      options: [
        { label: 'DM', value: 'dm' },
        { label: 'Mueller', value: 'mueller' },
        { label: 'Rossmann', value: 'rossmann' },
      ],
    },
    {
      name: 'url',
      type: 'text',
      label: 'URL',
      index: true,
    },
  ],
}
