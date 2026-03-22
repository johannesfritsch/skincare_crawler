import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFieldsNoMax, jobClaimProgressFields, DEFAULT_MAX_RETRIES } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'

export const VideoCrawls: CollectionConfig = {
  slug: 'video-crawls',
  labels: {
    singular: 'Video Crawl',
    plural: 'Video Crawls',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'crawled', 'errors', 'startedAt'],
    group: 'Videos',
  },
  hooks: {
    beforeChange: [
      enforceJobClaim,
      computeScheduledFor,
      createResetJobOnPending({
        total: null,
        crawled: 0,
        errors: 0,
        crawledVideoUrls: null,
        crawlProgress: null,
      }),
    ],
    afterChange: [
      rescheduleOnComplete,
    ],
  },
  fields: [
    jobStatusField,
    ...jobRetryFieldsNoMax,
    ...jobScheduleFields,
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Source',
          fields: [
            {
              name: 'type',
              type: 'select',
              label: 'What to Crawl',
              required: true,
              defaultValue: 'all',
              options: [
                { label: 'All Uncrawled', value: 'all' },
                { label: 'Specific URLs', value: 'selected_urls' },
                { label: 'From Discovery Job', value: 'from_discovery' },
              ],
              admin: {
                description:
                  '"All Uncrawled" finds videos with status=discovered. "From Discovery" uses URLs accumulated by a discovery job.',
              },
            },
            {
              name: 'scope',
              type: 'select',
              label: 'Scope',
              required: true,
              defaultValue: 'uncrawled_only',
              options: [
                { label: 'Only Uncrawled', value: 'uncrawled_only' },
                { label: 'Re-crawl All', value: 'recrawl' },
              ],
              admin: {
                description:
                  '"Only Uncrawled" skips videos already crawled. "Re-crawl All" re-downloads everything.',
                condition: (data) => data?.type === 'all',
              },
            },
            {
              name: 'urls',
              type: 'textarea',
              label: 'Video URLs',
              admin: {
                description:
                  'One YouTube video URL per line.',
                condition: (data) => data?.type === 'selected_urls',
              },
            },
            {
              name: 'discovery',
              type: 'relationship',
              relationTo: 'video-discoveries',
              label: 'Discovery Job',
              admin: {
                description:
                  'Crawl the video URLs found by this discovery job.',
                condition: (data) => data?.type === 'from_discovery',
              },
            },
          ],
        },
        {
          label: 'Stages',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'stageMetadata',
                  type: 'checkbox',
                  label: 'Metadata',
                  defaultValue: true,
                  admin: {
                    width: '33%',
                    description: 'Fetch yt-dlp metadata, resolve channel/creator, upload thumbnail, create/update video record.',
                  },
                },
                {
                  name: 'stageDownload',
                  type: 'checkbox',
                  label: 'Download',
                  defaultValue: true,
                  admin: {
                    width: '33%',
                    description: 'Download MP4 via yt-dlp, upload to video-media, update videoFile.',
                  },
                },
                {
                  name: 'stageAudio',
                  type: 'checkbox',
                  label: 'Audio',
                  defaultValue: true,
                  admin: {
                    width: '33%',
                    description: 'Extract audio via ffmpeg, upload WAV, update audioFile and set status=crawled.',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Configuration',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'itemsPerTick',
                  type: 'number',
                  label: 'Batch Size',
                  defaultValue: 5,
                  min: 1,
                  admin: {
                    width: '50%',
                    description: 'Videos to crawl per batch.',
                  },
                },
                {
                  name: 'maxRetries',
                  type: 'number',
                  label: 'Max Retries',
                  defaultValue: DEFAULT_MAX_RETRIES,
                  admin: {
                    width: '50%',
                    description: 'Maximum number of retries before the job is marked as failed. Set to 0 to disable retries.',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            ...jobClaimProgressFields,
            {
              name: 'total',
              type: 'number',
              label: 'Total',
              admin: {
                readOnly: true,
                description: 'Total videos to crawl',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'crawled',
                  type: 'number',
                  label: 'Crawled',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Videos successfully crawled',
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
                    description: 'Videos that failed to crawl',
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
          label: 'Output',
          fields: [
            {
              name: 'crawlProgress',
              type: 'json',
              label: 'Crawl Progress',
              admin: {
                hidden: true,
                description: 'Per-video stage progress map. Keys are videoId strings or url:<externalUrl>. Values are last completed stage name.',
              },
            },
            {
              name: 'crawledVideoUrls',
              type: 'textarea',
              validate: () => true,
              admin: {
                hidden: true,
              },
            },
            {
              name: 'crawledVideoUrlsDisplay',
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '@/components/JobOutputField',
                    clientProps: {
                      fieldName: 'crawledVideoUrls',
                      label: 'Crawled Video URLs',
                      description: 'One URL per line, accumulated during crawl.',
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
