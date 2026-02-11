import type { CollectionConfig } from 'payload'

export const VideoProcessings: CollectionConfig = {
  slug: 'video-processings',
  labels: {
    singular: 'Video Processing',
    plural: 'Video Processings',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'processed', 'errors', 'startedAt'],
    group: 'Jobs',
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Configuration',
          fields: [
            {
              name: 'type',
              type: 'select',
              label: 'Type',
              required: true,
              defaultValue: 'all_unprocessed',
              options: [
                { label: 'All Unprocessed', value: 'all_unprocessed' },
                { label: 'Single Video', value: 'single_video' },
              ],
            },
            {
              name: 'video',
              type: 'relationship',
              relationTo: 'videos',
              label: 'Video',
              admin: {
                description: 'The video to process',
                condition: (data) => data?.type === 'single_video',
              },
            },
            {
              name: 'sceneThreshold',
              type: 'number',
              label: 'Scene Threshold',
              defaultValue: 0.4,
              min: 0.01,
              max: 1,
              admin: {
                description: 'Scene change detection threshold (0-1). Lower = more sensitive, more segments.',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'processed',
                  type: 'number',
                  label: 'Processed',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Videos successfully processed',
                    width: '50%',
                  },
                },
                {
                  name: 'errors',
                  type: 'number',
                  label: 'Errors',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Videos that failed to process',
                    width: '50%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'startedAt',
                  type: 'date',
                  label: 'Started At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
                {
                  name: 'completedAt',
                  type: 'date',
                  label: 'Completed At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Pacing',
          fields: [
            {
              name: 'itemsPerTick',
              type: 'number',
              label: 'Items Per Tick',
              defaultValue: 1,
              min: 1,
              admin: {
                description: 'Number of videos to process per tick.',
              },
            },
          ],
        },
        {
          label: 'Events',
          fields: [
            {
              name: 'events',
              type: 'join',
              collection: 'events',
              on: 'job',
            },
          ],
        },
      ],
    },
  ],
}
