import type { CollectionConfig } from 'payload'

export const Galleries: CollectionConfig = {
  slug: 'galleries',
  labels: {
    singular: 'Gallery',
    plural: 'Galleries',
  },
  defaultSort: '-publishedAt',
  admin: {
    useAsTitle: 'caption',
    defaultColumns: ['caption', 'channel', 'status', 'publishedAt'],
    group: 'Galleries',
    components: {
      beforeListTable: ['@/components/GalleriesGallery'],
    },
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'gallery-items',
          where: { gallery: { equals: id } },
          req,
        })
      },
    ],
  },
  fields: [
    // ── Sidebar ──
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'discovered',
      options: [
        { label: 'Discovered', value: 'discovered' },
        { label: 'Crawled', value: 'crawled' },
        { label: 'Processed', value: 'processed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Lifecycle status: discovered → crawled → processed. Managed by the worker.',
      },
    },
    {
      name: 'channel',
      type: 'relationship',
      relationTo: 'channels',
      label: 'Channel',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'externalUrl',
      type: 'text',
      label: 'External URL',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'externalId',
      type: 'text',
      label: 'External ID',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Published At',
      admin: {
        position: 'sidebar',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'likeCount',
      type: 'number',
      label: 'Like Count',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'commentCount',
      type: 'number',
      label: 'Comment Count',
      admin: {
        position: 'sidebar',
      },
    },

    // ── Main area ──
    {
      name: 'caption',
      type: 'textarea',
      label: 'Caption',
    },
    {
      name: 'thumbnail',
      type: 'upload',
      relationTo: 'gallery-media',
      label: 'Thumbnail',
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Items',
          fields: [
            {
              name: 'galleryItems',
              type: 'join',
              collection: 'gallery-items',
              on: 'gallery',
              defaultLimit: 50,
              admin: {
                components: {
                  Field: '/components/GalleryItemsGrid',
                },
              },
            },
          ],
        },
        {
          label: 'Comments',
          fields: [
            {
              name: 'galleryComments',
              type: 'join',
              collection: 'gallery-comments',
              on: 'gallery',
              admin: {
                components: {
                  Field: '/components/GalleryComments',
                },
              },
            },
            {
              name: 'imageSourceUrls',
              type: 'json',
              admin: { hidden: true },
            },
          ],
        },
        {
          label: 'Mentions',
          fields: [
            {
              name: 'galleryMentions',
              type: 'join',
              collection: 'gallery-mentions',
              on: 'gallery',
            },
          ],
        },
      ],
      admin: {
        condition: (data) => !!data?.id,
      },
    },
  ],
}
