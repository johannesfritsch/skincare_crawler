import type { CollectionConfig } from 'payload'

export const Videos: CollectionConfig = {
  slug: 'videos',
  labels: {
    singular: 'Video',
    plural: 'Videos',
  },
  defaultSort: '-publishedAt',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'channel', 'publishedAt'],
    group: 'Videos',
    components: {
      edit: {
        SaveButton: '@/components/VideoSaveButton',
      },
      listMenuItems: ['@/components/bulk-actions/VideoBulkActions'],
      beforeListTable: ['@/components/bulk-actions/VideoBulkStatus'],
    },
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'video-snippets',
          where: { video: { equals: id } },
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
      name: 'duration',
      type: 'number',
      label: 'Duration',
      admin: {
        position: 'sidebar',
        description: 'Duration in seconds',
      },
    },
    {
      name: 'viewCount',
      type: 'number',
      label: 'View Count',
      admin: {
        position: 'sidebar',
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

    // ── Main area ──
    {
      name: 'embeddedPlayer',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/EmbeddedVideoPlayer',
        },
      },
    },
    {
      name: 'processStatus',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/VideoJobStatus',
        },
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Video',
          fields: [
            {
              name: 'title',
              type: 'text',
              label: 'Title',
              required: true,
            },
            {
              name: 'thumbnail',
              type: 'upload',
              relationTo: 'media',
              label: 'Thumbnail',
              admin: {
                description: 'Video thumbnail image (set during crawl).',
              },
            },
            {
              name: 'videoFile',
              type: 'upload',
              relationTo: 'media',
              label: 'Video File',
              admin: {
                description: 'Downloaded MP4 file (set during crawl).',
              },
            },
          ],
        },
        {
          label: 'Snippets',
          fields: [
            {
              name: 'videoSnippets',
              type: 'join',
              collection: 'video-snippets',
              on: 'video',
              defaultSort: 'timestampStart',
              admin: {
                defaultColumns: ['timestampStart', 'matchingType', 'referencedProducts'],
              },
            },
          ],
        },
        {
          label: 'Transcript',
          fields: [
            {
              name: 'transcript',
              type: 'textarea',
              label: 'Transcript',
              admin: {
                description: 'Full corrected transcript of the video audio',
              },
            },
          ],
        },
        {
          label: 'Transcript Words',
          fields: [
            {
              name: 'transcriptWords',
              type: 'json',
              label: 'Transcript Words',
              admin: {
                description: 'Word-level timestamps from speech recognition: [{ word, start, end, confidence }]',
              },
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
