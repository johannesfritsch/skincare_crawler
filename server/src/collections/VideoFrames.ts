import type { CollectionConfig } from 'payload'

export const VideoFrames: CollectionConfig = {
  slug: 'video-frames',
  labels: {
    singular: 'Video Frame',
    plural: 'Video Frames',
  },
  admin: {
    useAsTitle: 'scene',
    defaultColumns: ['scene', 'recognitionCandidate', 'barcode', 'createdAt'],
    group: 'Videos',
  },
  fields: [
    {
      name: 'scene',
      type: 'relationship',
      relationTo: 'video-scenes',
      label: 'Scene',
      required: true,
      index: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'video-media',
      label: 'Image',
      required: true,
    },
    {
      name: 'barcode',
      type: 'text',
      label: 'Barcode',
      admin: {
        description: 'EAN-13/EAN-8 barcode detected in this frame',
      },
    },
    {
      name: 'recognitionCandidate',
      type: 'checkbox',
      label: 'Recognition Candidate',
      admin: {
        description:
          'Whether this frame was selected as a cluster representative for product recognition',
      },
    },
    {
      name: 'recognitionThumbnail',
      type: 'upload',
      relationTo: 'video-media',
      label: 'Recognition Thumbnail',
      admin: {
        description: '128x128 color thumbnail used for product classification',
      },
    },
    {
      name: 'detections',
      type: 'array',
      label: 'Detections',
      admin: {
        description:
          'Object detections from Grounding DINO. Each entry is a cropped region with bounding box, optional CLIP match, and debug info.',
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
            description:
              'Cosine distance from CLIP search (lower = better match, 0 = identical).',
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
}
