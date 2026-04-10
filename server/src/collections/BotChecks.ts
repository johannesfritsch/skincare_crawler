import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'

export const BotChecks: CollectionConfig = {
  slug: 'bot-checks',
  labels: {
    singular: 'Bot Check',
    plural: 'Bot Checks',
  },
  admin: {
    useAsTitle: 'url',
    defaultColumns: ['url', 'status', 'passed', 'failed', 'total', 'createdAt'],
    group: 'System',
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      passed: 0, failed: 0, total: 0,
    })],
    afterChange: [rescheduleOnComplete],
  },
  fields: [
    jobStatusField,
    ...jobRetryFields,
    ...jobScheduleFields,
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Source',
          fields: [
            {
              name: 'url',
              type: 'text',
              label: 'URL',
              required: true,
              defaultValue: 'https://bot-detector.rebrowser.net/',
              admin: {
                description: 'URL to visit for bot detection testing',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            ...jobClaimProgressFields,
            {
              type: 'row',
              fields: [
                {
                  name: 'passed',
                  type: 'number',
                  label: 'Passed',
                  defaultValue: 0,
                  admin: { readOnly: true, width: '33%' },
                },
                {
                  name: 'failed',
                  type: 'number',
                  label: 'Failed',
                  defaultValue: 0,
                  admin: { readOnly: true, width: '33%' },
                },
                {
                  name: 'total',
                  type: 'number',
                  label: 'Total',
                  defaultValue: 0,
                  admin: { readOnly: true, width: '33%' },
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
                    date: { pickerAppearance: 'dayAndTime' },
                  },
                },
                {
                  name: 'completedAt',
                  type: 'date',
                  label: 'Completed At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: { pickerAppearance: 'dayAndTime' },
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Results',
          fields: [
            {
              name: 'botCheckResults',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/BotCheckResults',
                },
              },
            },
            {
              name: 'screenshot',
              type: 'upload',
              relationTo: 'debug-screenshots',
              label: 'Screenshot',
              admin: {
                readOnly: true,
                description: 'Full-page screenshot from the bot check',
              },
            },
            {
              name: 'resultJson',
              type: 'json',
              label: 'Raw Results',
              admin: {
                readOnly: true,
                description: 'Detailed test results from the bot detector page',
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
