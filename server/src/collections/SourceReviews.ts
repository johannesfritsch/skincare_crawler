import type { CollectionConfig } from 'payload'

export const SourceReviews: CollectionConfig = {
  slug: 'source-reviews',
  labels: {
    singular: 'Source Review',
    plural: 'Source Reviews',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'rating', 'userNickname', 'submittedAt'],
    group: 'Source Products',
    description: 'Individual reviews crawled from source stores',
  },
  fields: [
    // ── Sidebar ──
    {
      name: 'sourceProduct',
      type: 'relationship',
      relationTo: 'source-products',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'sourceVariants',
      type: 'relationship',
      relationTo: 'source-variants',
      hasMany: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'externalId',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'External review ID (e.g. BazaarVoice review ID)',
      },
    },
    {
      name: 'rating',
      type: 'number',
      required: true,
      min: 0,
      max: 10,
      admin: {
        position: 'sidebar',
        description: 'Normalized rating (0-10 scale)',
      },
    },
    {
      name: 'submittedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },

    // ── Main area (tabs) ──
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Review',
          fields: [
            {
              name: 'title',
              type: 'text',
            },
            {
              name: 'reviewText',
              type: 'textarea',
            },
          ],
        },
        {
          label: 'Reviewer',
          fields: [
            {
              name: 'userNickname',
              type: 'text',
            },
            {
              name: 'reviewerAge',
              type: 'text',
              admin: {
                description: 'Age range, e.g. "25to34"',
              },
            },
            {
              name: 'reviewerGender',
              type: 'text',
              admin: {
                description: 'Gender, e.g. "Female"',
              },
            },
          ],
        },
        {
          label: 'Feedback',
          fields: [
            {
              name: 'isRecommended',
              type: 'checkbox',
            },
            {
              name: 'positiveFeedbackCount',
              type: 'number',
              defaultValue: 0,
            },
            {
              name: 'negativeFeedbackCount',
              type: 'number',
              defaultValue: 0,
            },
          ],
        },
      ],
    },
  ],
}
