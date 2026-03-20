import type { CollectionConfig } from 'payload'

export const VideoFrames: CollectionConfig = {
  slug: 'video-frames',
  labels: {
    singular: 'Video Frame',
    plural: 'Video Frames',
  },
  admin: {
    useAsTitle: 'scene',
    defaultColumns: ['scene', 'isClusterRepresentative', 'createdAt'],
    group: 'Videos',
    hidden: true,
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
      name: 'frameIndex',
      type: 'number',
      label: 'Frame Index',
      admin: { description: 'Zero-based index of this frame within its scene (after dedup)' },
    },
    {
      name: 'frameTime',
      type: 'number',
      label: 'Frame Time (s)',
      admin: { description: 'Approximate timestamp in the video (seconds from start)' },
    },
    {
      name: 'isClusterRepresentative',
      type: 'checkbox',
      label: 'Cluster Representative',
      admin: {
        description:
          'Whether this frame was selected as a cluster representative for product recognition and object detection',
      },
    },
    {
      name: 'clusterThumbnail',
      type: 'upload',
      relationTo: 'video-media',
      label: 'Cluster Thumbnail',
      admin: {
        description: '128x128 color thumbnail used for LLM product classification',
      },
    },
  ],
}
