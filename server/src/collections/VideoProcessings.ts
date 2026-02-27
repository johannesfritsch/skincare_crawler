import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'

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
  hooks: {
    beforeChange: [enforceJobClaim],
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
    ...jobClaimFields,
    {
      name: 'itemsPerTick',
      type: 'number',
      label: 'Batch Size',
      defaultValue: 1,
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Videos to process per batch.',
      },
    },
    {
      name: 'startedAt',
      type: 'date',
      label: 'Started At',
      admin: {
        readOnly: true,
        position: 'sidebar',
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
        position: 'sidebar',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Source',
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
                { label: 'Selected URLs', value: 'selected_urls' },
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
              name: 'urls',
              type: 'textarea',
              label: 'URLs',
              admin: {
                description: 'Video or channel URLs to process, one per line',
                condition: (data) => data?.type === 'selected_urls',
              },
            },
          ],
        },
        {
          label: 'Image Recognition',
          fields: [
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
            {
              name: 'clusterThreshold',
              type: 'number',
              label: 'Cluster Threshold',
              defaultValue: 25,
              min: 1,
              max: 64,
              admin: {
                description: 'Hamming distance threshold for screenshot clustering (1-64). Lower = stricter grouping, more clusters.',
              },
            },
          ],
        },
        {
          label: 'Transcription',
          fields: [
            {
              name: 'transcriptionEnabled',
              type: 'checkbox',
              label: 'Transcription Enabled',
              defaultValue: true,
              admin: {
                description: 'Enable speech-to-text transcription via Deepgram and sentiment analysis.',
              },
            },
            {
              name: 'transcriptionLanguage',
              type: 'select',
              label: 'Transcription Language',
              defaultValue: 'de',
              options: [
                { label: 'German', value: 'de' },
                { label: 'English', value: 'en' },
                { label: 'French', value: 'fr' },
                { label: 'Spanish', value: 'es' },
                { label: 'Italian', value: 'it' },
              ],
              admin: {
                description: 'Language for speech recognition.',
                condition: (data) => data?.transcriptionEnabled === true,
              },
            },
            {
              name: 'transcriptionModel',
              type: 'select',
              label: 'Transcription Model',
              defaultValue: 'nova-3',
              options: [
                { label: 'Nova 3 (Latest)', value: 'nova-3' },
                { label: 'Nova 2', value: 'nova-2' },
                { label: 'Enhanced', value: 'enhanced' },
                { label: 'Base', value: 'base' },
              ],
              admin: {
                description: 'Deepgram model to use for speech recognition.',
                condition: (data) => data?.transcriptionEnabled === true,
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
                  name: 'total',
                  type: 'number',
                  label: 'Total',
                  admin: {
                    readOnly: true,
                    description: 'Total videos to process',
                    width: '34%',
                  },
                },
                {
                  name: 'processed',
                  type: 'number',
                  label: 'Processed',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Videos successfully processed',
                    width: '33%',
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
                    width: '33%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'tokensUsed',
                  type: 'number',
                  label: 'Total Tokens',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Total LLM tokens consumed across all steps',
                    width: '50%',
                  },
                },
                {
                  name: 'tokensRecognition',
                  type: 'number',
                  label: 'Recognition',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Tokens used for visual product recognition',
                    width: '50%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'tokensTranscriptCorrection',
                  type: 'number',
                  label: 'Correction',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Tokens used for LLM transcript correction',
                    width: '50%',
                  },
                },
                {
                  name: 'tokensSentiment',
                  type: 'number',
                  label: 'Sentiment',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Tokens used for sentiment & quote extraction',
                    width: '50%',
                  },
                },
              ],
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
