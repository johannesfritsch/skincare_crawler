import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'
import { deleteWorkItems } from '@/hooks/deleteWorkItems'

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
      completed: 0, errors: 0, total: 0,
    })],
    afterChange: [rescheduleOnComplete],
    afterDelete: [deleteWorkItems('bot-checks')],
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
            ...jobProgressFields,
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
