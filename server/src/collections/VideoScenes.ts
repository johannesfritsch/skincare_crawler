import type { CollectionConfig } from 'payload'

export const VideoScenes: CollectionConfig = {
  slug: 'video-scenes',
  labels: {
    singular: 'Video Scene',
    plural: 'Video Scenes',
  },
  admin: {
    useAsTitle: 'video',
    defaultColumns: ['video', 'timestampStart', 'matchingType', 'referencedProducts'],
    group: 'Videos',
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'video-mentions',
          where: { videoScene: { equals: id } },
          req,
        })
        await req.payload.delete({
          collection: 'video-frames',
          where: { scene: { equals: id } },
          req,
        })
      },
    ],
  },
  fields: [
    // --- Sidebar ---
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
      name: 'timestampStart',
      type: 'number',
      label: 'Timestamp Start',
      admin: {
        position: 'sidebar',
        description: 'Start time in seconds',
      },
    },
    {
      name: 'timestampEnd',
      type: 'number',
      label: 'Timestamp End',
      admin: {
        position: 'sidebar',
        description: 'End time in seconds',
      },
    },
    // --- Tabs ---
    {
      type: 'tabs',
      tabs: [
        {
          label: 'General',
          fields: [
            {
              name: 'embeddedPlayer',
              type: 'ui',
              admin: {
                components: {
                  Field: '/components/EmbeddedScenePlayer',
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
              relationTo: 'video-media',
              label: 'Image',
            },
          ],
        },
        {
          label: 'Products',
          fields: [
            {
              name: 'referencedProducts',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              label: 'Referenced Products',
            },
            {
              name: 'videoMentions',
              type: 'join',
              collection: 'video-mentions',
              on: 'videoScene',
              admin: {
                defaultColumns: ['product', 'overallSentiment', 'overallSentimentScore'],
              },
            },
          ],
        },
        {
          label: 'Transcription',
          fields: [
            {
              name: 'preTranscript',
              type: 'textarea',
              label: 'Pre-Transcript',
              admin: {
                description: '5 seconds of spoken context before this scene',
              },
            },
            {
              name: 'transcript',
              type: 'textarea',
              label: 'Transcript',
              admin: {
                description: 'Spoken words within this scene time range',
              },
            },
            {
              name: 'postTranscript',
              type: 'textarea',
              label: 'Post-Transcript',
              admin: {
                description: '3 seconds of spoken context after this scene',
              },
            },
          ],
        },
        {
          label: 'Frames',
          fields: [
            {
              name: 'frames',
              type: 'join',
              collection: 'video-frames',
              on: 'scene',
              admin: {
                defaultColumns: ['image', 'recognitionCandidate', 'barcode'],
              },
            },
          ],
        },
      ],
    },
  ],
}
