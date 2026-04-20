import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFieldsNoMax, jobClaimProgressFields, jobProgressFields, DEFAULT_MAX_RETRIES } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'
import { deleteWorkItems } from '@/hooks/deleteWorkItems'

export const GalleryCrawls: CollectionConfig = {
  slug: 'gallery-crawls',
  labels: {
    singular: 'Gallery Crawl',
    plural: 'Gallery Crawls',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'crawled', 'errors', 'startedAt'],
    group: 'Galleries',
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [
      enforceJobClaim,
      computeScheduledFor,
      createResetJobOnPending({
        total: null,
        completed: 0,
        errors: 0,
        crawledGalleryUrls: null,
        crawlProgress: null,
      }),
    ],
    afterChange: [
      rescheduleOnComplete,
    ],
    afterDelete: [deleteWorkItems('gallery-crawls')],
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
                  '"All Uncrawled" finds galleries with status=discovered. "From Discovery" uses URLs accumulated by a discovery job.',
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
                  '"Only Uncrawled" skips galleries already crawled. "Re-crawl All" re-downloads everything.',
                condition: (data) => data?.type === 'all',
              },
            },
            {
              name: 'urls',
              type: 'textarea',
              label: 'Gallery URLs',
              admin: {
                description:
                  'One gallery URL per line.',
                condition: (data) => data?.type === 'selected_urls',
              },
            },
            {
              name: 'discovery',
              type: 'relationship',
              relationTo: 'gallery-discoveries',
              label: 'Discovery Job',
              admin: {
                description:
                  'Crawl the gallery URLs found by this discovery job.',
                condition: (data) => data?.type === 'from_discovery',
              },
            },
          ],
        },
        {
          label: 'Configuration',
          fields: [
            {
              name: 'maxRetries',
              type: 'number',
              label: 'Max Retries',
              defaultValue: DEFAULT_MAX_RETRIES,
              admin: {
                description: 'Maximum number of retries before the job is marked as failed. Set to 0 to disable retries.',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            ...jobClaimProgressFields,
            ...jobProgressFields,
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
                description: 'Per-gallery stage progress map. Keys are galleryId strings or url:<externalUrl>. Values are last completed stage name.',
              },
            },
            {
              name: 'crawledGalleryUrls',
              type: 'textarea',
              validate: () => true,
              admin: {
                hidden: true,
              },
            },
            {
              name: 'crawledGalleryUrlsDisplay',
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '@/components/JobOutputField',
                    clientProps: {
                      fieldName: 'crawledGalleryUrls',
                      label: 'Crawled Gallery URLs',
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
