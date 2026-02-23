import type { CollectionConfig } from 'payload'

export const VideoSnippets: CollectionConfig = {
  slug: 'video-snippets',
  labels: {
    singular: 'Video Snippet',
    plural: 'Video Snippets',
  },
  admin: {
    useAsTitle: 'video',
    defaultColumns: ['video', 'timestampStart', 'matchingType', 'referencedProducts'],
    group: 'Social Media',
  },
  fields: [
    {
      name: 'matchingType',
      type: 'select',
      label: 'Matching Type',
      options: [
        { label: 'Barcode', value: 'barcode' },
        { label: 'Visual', value: 'visual' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'embeddedPlayer',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/EmbeddedSnippetPlayer',
        },
      },
    },
    {
      name: 'video',
      type: 'relationship',
      relationTo: 'videos',
      label: 'Video',
      required: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Image',
    },
    {
      name: 'timestampStart',
      type: 'number',
      label: 'Timestamp Start',
      admin: {
        description: 'Start time in seconds',
      },
    },
    {
      name: 'timestampEnd',
      type: 'number',
      label: 'Timestamp End',
      admin: {
        description: 'End time in seconds',
      },
    },
    {
      name: 'screenshots',
      type: 'array',
      label: 'Screenshots',
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Image',
          required: true,
        },
        {
          name: 'thumbnail',
          type: 'upload',
          relationTo: 'media',
          label: 'Thumbnail',
          admin: {
            description: '64x64 grayscale thumbnail used for image hashing',
            condition: (data) => data?.matchingType !== 'barcode',
          },
        },
        {
          name: 'hash',
          type: 'text',
          label: 'Image Hash',
          admin: {
            description: 'Perceptual hash of the thumbnail',
            condition: (data) => data?.matchingType !== 'barcode',
          },
        },
        {
          name: 'distance',
          type: 'number',
          label: 'Distance',
          admin: {
            description: 'Hamming distance to assigned cluster representative hash',
            condition: (data) => data?.matchingType !== 'barcode',
          },
        },
        {
          name: 'screenshotGroup',
          type: 'number',
          label: 'Screenshot Group',
          admin: {
            description: 'Cluster ID — screenshots with similar visual content share a cluster',
            condition: (data) => data?.matchingType !== 'barcode',
          },
        },
        {
          name: 'barcode',
          type: 'text',
          label: 'Barcode',
          admin: {
            description: 'EAN-13/EAN-8 barcode detected in this screenshot',
          },
        },
        {
          name: 'recognitionCandidate',
          type: 'checkbox',
          label: 'Recognition Candidate',
          admin: {
            description:
              'Whether this screenshot was selected as a cluster representative for product recognition',
            condition: (data) => data?.matchingType === 'visual',
          },
        },
        {
          name: 'recognitionThumbnail',
          type: 'upload',
          relationTo: 'media',
          label: 'Recognition Thumbnail',
          admin: {
            description: '128x128 color thumbnail used for product classification',
            condition: (data) => data?.matchingType === 'visual',
          },
        },
      ],
    },
    {
      name: 'referencedProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Referenced Products',
    },
    {
      name: 'preTranscript',
      type: 'textarea',
      label: 'Pre-Transcript',
      admin: {
        description: '5 seconds of spoken context before this snippet',
      },
    },
    {
      name: 'transcript',
      type: 'textarea',
      label: 'Transcript',
      admin: {
        description: 'Spoken words within this snippet time range',
      },
    },
    {
      name: 'postTranscript',
      type: 'textarea',
      label: 'Post-Transcript',
      admin: {
        description: '3 seconds of spoken context after this snippet',
      },
    },
    {
      name: 'videoQuotes',
      type: 'join',
      collection: 'video-quotes',
      on: 'videoSnippet',
      admin: {
        defaultColumns: ['product', 'overallSentiment', 'overallSentimentScore'],
      },
    },
  ],
}
