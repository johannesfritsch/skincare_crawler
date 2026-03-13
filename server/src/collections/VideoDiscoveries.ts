import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'

export const VideoDiscoveries: CollectionConfig = {
  slug: 'video-discoveries',
  labels: {
    singular: 'Video Discovery',
    plural: 'Video Discoveries',
  },
  admin: {
    useAsTitle: 'channelUrl',
    defaultColumns: ['channelUrl', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Videos',
  },
  hooks: {
    beforeChange: [enforceJobClaim],
  },
  fields: [
    {
      name: 'channelUrl',
      type: 'text',
      label: 'Channel URL',
      required: true,
      admin: {
        description: 'The channel URL to discover videos from (e.g. https://www.youtube.com/@xskincare)',
      },
    },
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
    ...jobClaimFields,
    {
      name: 'itemsPerTick',
      type: 'number',
      label: 'Videos per Batch',
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Videos fetched per claim cycle. Default: 50. Empty = 50.',
      },
    },
    {
      name: 'maxVideos',
      type: 'number',
      label: 'Max Videos',
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Stop after this many videos. Empty = unlimited (all videos on channel).',
      },
    },
    // Worker accumulates discovered video URLs here; shown read-only on the Output tab
    {
      name: 'videoUrls',
      type: 'textarea',
      validate: () => true,
      admin: {
        hidden: true,
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Progress',
          fields: [
            {
              name: 'discovered',
              type: 'number',
              label: 'Discovered',
              defaultValue: 0,
              admin: {
                readOnly: true,
                description: 'Video URLs found on the channel',
              },
            },
            {
              name: 'progress',
              type: 'json',
              label: 'Progress State',
              admin: {
                readOnly: true,
                description: 'Internal state for resumable discovery (currentOffset)',
              },
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
          label: 'Output',
          fields: [
            {
              name: 'videoUrlsDisplay',
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '@/components/JobOutputField',
                    clientProps: {
                      fieldName: 'videoUrls',
                      label: 'Discovered Video URLs',
                      description: 'One URL per line, accumulated during discovery.',
                    },
                  },
                },
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
      admin: {
        condition: (data) => !!data?.id,
      },
    },
  ],
}
