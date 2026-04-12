import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'

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
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      completed: 0, errors: 0, progress: null, videoUrls: '',
    })],
    afterChange: [rescheduleOnComplete],
  },
  fields: [
    jobStatusField,
    ...jobRetryFields,
    ...jobScheduleFields,
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
          label: 'Source',
          fields: [
            {
              name: 'channelUrl',
              type: 'text',
              label: 'Channel URL',
              required: true,
              admin: {
                description: 'The channel URL to discover videos from (e.g. https://www.youtube.com/@xskincare, https://www.instagram.com/xskincare/reels/, https://www.tiktok.com/@xskincare/posts)',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'itemsPerTick',
                  type: 'number',
                  label: 'Videos per Batch',
                  min: 1,
                  admin: {
                    width: '33%',
                    description: 'Videos fetched per claim cycle. Default: 50. Empty = 50.',
                  },
                },
                {
                  name: 'maxVideos',
                  type: 'number',
                  label: 'Max Videos',
                  min: 1,
                  admin: {
                    width: '33%',
                    description: 'Stop after this many videos. Empty = unlimited (all videos on channel).',
                  },
                },
                {
                  name: 'dateLimit',
                  type: 'text',
                  label: 'Date Limit',
                  admin: {
                    width: '33%',
                    description: 'Only discover videos newer than this. E.g. "5 days", "2 weeks", "1 month". Empty = no date filter.',
                  },
                },
              ],
            },
            {
              name: 'debugMode',
              type: 'checkbox',
              label: 'Debug Mode',
              defaultValue: false,
              admin: {
                description: 'When enabled, publishes each line of stdout/stderr from yt-dlp/gallery-dl as a separate event (visible in the Events tab).',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            ...jobClaimProgressFields,
            ...jobProgressFields,
            {
              name: 'progress',
              type: 'json',
              label: 'Progress State',
              admin: {
                readOnly: true,
                description: 'Internal state for resumable discovery (currentOffset)',
              },
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
              name: 'eventsView',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/EventsView',
                },
              },
            },
          ],
        },
      ],
    },
  ],
}
