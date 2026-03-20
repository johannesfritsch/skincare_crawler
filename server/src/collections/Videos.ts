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
          collection: 'video-scenes',
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
      defaultValue: 'crawled',
      options: [
        { label: 'Crawled', value: 'crawled' },
        { label: 'Processed', value: 'processed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Lifecycle status: crawled → processed. Managed by the worker.',
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
          label: 'Scenes',
          fields: [
            {
              name: 'videoScenes',
              type: 'join',
              collection: 'video-scenes',
              on: 'video',
              defaultSort: 'timestampStart',
              defaultLimit: 200,
              admin: {
                components: {
                  Field: '/components/ScenesGallery',
                },
              },
            },
          ],
        },
        {
          label: 'Video Details',
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
              relationTo: 'video-media',
              label: 'Thumbnail',
              admin: {
                description: 'Video thumbnail image (set during crawl).',
              },
            },
            {
              name: 'videoFile',
              type: 'upload',
              relationTo: 'video-media',
              label: 'Video File',
              admin: {
                description: 'Downloaded MP4 file (set during crawl).',
              },
            },
            {
              name: 'audioFile',
              type: 'upload',
              relationTo: 'video-media',
              label: 'Audio File',
              admin: {
                description: 'Extracted WAV audio (set during crawl, used by transcription).',
              },
            },
            {
              name: 'transcript',
              type: 'textarea',
              label: 'Transcript',
              admin: {
                description: 'Full corrected transcript of the entire video (set during transcription stage).',
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
