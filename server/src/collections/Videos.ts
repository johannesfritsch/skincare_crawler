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
    },
  },
  fields: [
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
      name: 'channel',
      type: 'relationship',
      relationTo: 'channels',
      label: 'Channel',
      required: true,
    },
    {
      name: 'title',
      type: 'text',
      label: 'Title',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Image',
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Published At',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'processingStatus',
      type: 'select',
      label: 'Processing Status',
      defaultValue: 'unprocessed',
      options: [
        { label: 'Unprocessed', value: 'unprocessed' },
        { label: 'Processed', value: 'processed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'duration',
      type: 'number',
      label: 'Duration',
      admin: {
        description: 'Duration in seconds',
      },
    },
    {
      name: 'viewCount',
      type: 'number',
      label: 'View Count',
    },
    {
      name: 'likeCount',
      type: 'number',
      label: 'Like Count',
    },
    {
      name: 'externalUrl',
      type: 'text',
      label: 'External URL',
    },
    {
      name: 'transcript',
      type: 'textarea',
      label: 'Transcript',
      admin: {
        description: 'Full corrected transcript of the video audio',
      },
    },
    {
      name: 'transcriptWords',
      type: 'json',
      label: 'Transcript Words',
      admin: {
        description: 'Word-level timestamps from speech recognition: [{ word, start, end, confidence }]',
      },
    },
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
}
