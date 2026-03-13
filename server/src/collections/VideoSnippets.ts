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
    group: 'Videos',
  },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Cascade delete: remove child records that have required (NOT NULL) references
        await req.payload.delete({
          collection: 'video-mentions',
          where: { videoSnippet: { equals: id } },
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
              relationTo: 'video-media',
              label: 'Image',
            },
          ],
        },
        {
          label: 'Mentioned Products',
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
              on: 'videoSnippet',
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
          ],
        },
        {
          label: 'Detections',
          fields: [
            {
              name: 'detections',
              type: 'array',
              label: 'Detections',
              admin: {
                description:
                  'Object detections from Grounding DINO on video screenshots. Each entry is a cropped region with bounding box, optional CLIP match, and debug info.',
              },
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'detection-media',
                  label: 'Detection Crop',
                  required: true,
                },
                {
                  name: 'score',
                  type: 'number',
                  label: 'Detection Score',
                  min: 0,
                  max: 1,
                  admin: {
                    step: 0.001,
                    description: 'Grounding DINO detection confidence (0-1)',
                  },
                },
                {
                  name: 'screenshotIndex',
                  type: 'number',
                  label: 'Screenshot Index',
                  admin: {
                    description: '0-based index into the screenshots array',
                  },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'boxXMin',
                      type: 'number',
                      label: 'Box X Min',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'boxYMin',
                      type: 'number',
                      label: 'Box Y Min',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'boxXMax',
                      type: 'number',
                      label: 'Box X Max',
                      admin: { width: '25%' },
                    },
                    {
                      name: 'boxYMax',
                      type: 'number',
                      label: 'Box Y Max',
                      admin: { width: '25%' },
                    },
                  ],
                },
                {
                  name: 'hasEmbedding',
                  type: 'checkbox',
                  label: 'Has Embedding',
                  defaultValue: false,
                  admin: {
                    readOnly: true,
                    description: 'Whether a CLIP embedding was computed for this crop.',
                  },
                },
                {
                  name: 'matchedProduct',
                  type: 'relationship',
                  relationTo: 'products',
                  label: 'Matched Product',
                  admin: {
                    description: 'Product matched by CLIP visual similarity search.',
                  },
                },
                {
                  name: 'matchDistance',
                  type: 'number',
                  label: 'Match Distance',
                  admin: {
                    step: 0.001,
                    description: 'Cosine distance from CLIP search (lower = better match, 0 = identical).',
                  },
                },
                {
                  name: 'matchedGtin',
                  type: 'text',
                  label: 'Matched GTIN',
                  admin: {
                    description: 'GTIN of the matched product-variant (for quick debugging).',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Screenshots',
          fields: [
            {
              name: 'screenshots',
              type: 'array',
              label: 'Screenshots',
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'video-media',
                  label: 'Image',
                  required: true,
                },
                {
                  name: 'thumbnail',
                  type: 'upload',
                  relationTo: 'video-media',
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
                    description:
                      'Cluster ID — screenshots with similar visual content share a cluster',
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
                  relationTo: 'video-media',
                  label: 'Recognition Thumbnail',
                  admin: {
                    description: '128x128 color thumbnail used for product classification',
                    condition: (data) => data?.matchingType === 'visual',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
