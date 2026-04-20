import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'
import { deleteWorkItems } from '@/hooks/deleteWorkItems'

export const GalleryDiscoveries: CollectionConfig = {
  slug: 'gallery-discoveries',
  labels: {
    singular: 'Gallery Discovery',
    plural: 'Gallery Discoveries',
  },
  admin: {
    useAsTitle: 'channelUrl',
    defaultColumns: ['channelUrl', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Galleries',
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      completed: 0, errors: 0, progress: null, galleryUrls: '',
    })],
    afterChange: [rescheduleOnComplete],
    afterDelete: [deleteWorkItems('gallery-discoveries')],
  },
  fields: [
    jobStatusField,
    ...jobRetryFields,
    ...jobScheduleFields,
    // Worker accumulates discovered gallery URLs here; shown read-only on the Output tab
    {
      name: 'galleryUrls',
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
                description: 'The channel URL to discover galleries from (e.g. https://www.instagram.com/xskincare/, https://www.tiktok.com/@xskincare/posts)',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'maxGalleries',
                  type: 'number',
                  label: 'Max Galleries',
                  min: 1,
                  admin: {
                    width: '50%',
                    description: 'Stop after this many galleries. Empty = unlimited (all galleries on channel).',
                  },
                },
                {
                  name: 'dateLimit',
                  type: 'text',
                  label: 'Date Limit',
                  admin: {
                    width: '50%',
                    description: 'Only discover galleries newer than this. E.g. "5 days", "2 weeks", "1 month". Empty = no date filter.',
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
                description: 'When enabled, publishes each line of stdout/stderr from gallery-dl as a separate event (visible in the Events tab).',
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
              name: 'galleryUrlsDisplay',
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '@/components/JobOutputField',
                    clientProps: {
                      fieldName: 'galleryUrls',
                      label: 'Discovered Gallery URLs',
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
