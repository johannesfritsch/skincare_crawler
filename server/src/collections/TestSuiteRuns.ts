import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'

export const TestSuiteRuns: CollectionConfig = {
  slug: 'test-suite-runs',
  labels: {
    singular: 'Test Suite Run',
    plural: 'Test Suite Runs',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['testSuite', 'status', 'currentPhase', 'startedAt', 'completedAt'],
    group: 'System',
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      currentPhase: 'pending',
      completed: 0,
      errors: 0,
    })],
    afterChange: [rescheduleOnComplete],
  },
  fields: [
    jobStatusField,
    ...jobRetryFields,
    ...jobScheduleFields,
    {
      name: 'testSuite',
      type: 'relationship',
      relationTo: 'test-suites',
      required: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'currentPhase',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Searches', value: 'searches' },
        { label: 'Discoveries', value: 'discoveries' },
        { label: 'Crawls', value: 'crawls' },
        { label: 'Aggregations', value: 'aggregations' },
        { label: 'Done', value: 'done' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'phaseStatus',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/TestSuitePhaseStatus',
        },
      },
    },
    {
      type: 'tabs',
      tabs: [
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
              name: 'phases',
              type: 'json',
              label: 'Phase Details',
              admin: {
                readOnly: true,
                description: 'Per-phase status, job IDs, and validation results',
              },
            },
            {
              name: 'failureReason',
              type: 'textarea',
              admin: {
                readOnly: true,
                description: 'Details of why the run failed (if applicable)',
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
