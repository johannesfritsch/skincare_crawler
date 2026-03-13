import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobClaimFieldsNoRetries, DEFAULT_MAX_RETRIES } from '@/hooks/jobClaimFields'

export const VideoProcessings: CollectionConfig = {
  slug: 'video-processings',
  labels: {
    singular: 'Video Processing',
    plural: 'Video Processings',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'completed', 'errors', 'startedAt'],
    group: 'Videos',
  },
  hooks: {
    beforeChange: [
      enforceJobClaim,
      createResetJobOnPending({
        total: null,
        completed: 0,
        errors: 0,
        tokensUsed: 0,
        tokensRecognition: 0,
        tokensTranscriptCorrection: 0,
        tokensSentiment: 0,
        videoProgress: null,
      }),
    ],
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
    ...jobClaimFieldsNoRetries,
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
                { label: 'From Crawl Job', value: 'from_crawl' },
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
            {
              name: 'crawl',
              type: 'relationship',
              relationTo: 'video-crawls',
              label: 'Crawl Job',
              admin: {
                description: 'Process the videos crawled by this crawl job.',
                condition: (data) => data?.type === 'from_crawl',
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
                  name: 'stageSceneDetection',
                  type: 'checkbox',
                  label: 'Scene Detection',
                  defaultValue: true,
                  admin: {
                    description: 'Detect scenes, extract screenshots, scan barcodes.',
                    width: '20%',
                  },
                },
                {
                  name: 'stageProductRecognition',
                  type: 'checkbox',
                  label: 'Product Recognition',
                  defaultValue: true,
                  admin: {
                    description: 'LLM visual recognition and GTIN lookup.',
                    width: '20%',
                  },
                },
                {
                  name: 'stageScreenshotDetection',
                  type: 'checkbox',
                  label: 'Screenshot Detection',
                  defaultValue: true,
                  admin: {
                    description: 'Grounding DINO object detection on video screenshots.',
                    width: '20%',
                  },
                },
                {
                  name: 'stageScreenshotSearch',
                  type: 'checkbox',
                  label: 'Screenshot Search',
                  defaultValue: true,
                  admin: {
                    description: 'CLIP visual similarity search against product embeddings.',
                    width: '20%',
                  },
                },
                {
                  name: 'stageTranscription',
                  type: 'checkbox',
                  label: 'Transcription',
                  defaultValue: true,
                  admin: {
                    description: 'Speech-to-text via Deepgram with LLM correction.',
                    width: '20%',
                  },
                },
                {
                  name: 'stageSentimentAnalysis',
                  type: 'checkbox',
                  label: 'Sentiment Analysis',
                  defaultValue: true,
                  admin: {
                    description: 'LLM quote extraction and sentiment scoring.',
                    width: '20%',
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
                  defaultValue: 1,
                  min: 1,
                  admin: {
                    width: '50%',
                    description: 'Videos to process per batch.',
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
            {
              type: 'row',
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
                    width: '50%',
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
                    width: '50%',
                  },
                },
              ],
            },
            {
              name: 'minBoxArea',
              type: 'number',
              label: 'Min Detection Box Area (%)',
              defaultValue: 25,
              min: 0,
              max: 100,
              admin: {
                description:
                  'Minimum detection box area as a percentage of the screenshot area. ' +
                  'Detections smaller than this are discarded as background noise. Default: 25% (foreground products only).',
              },
            },
            {
              type: 'row',
              fields: [
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
                    width: '50%',
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
                    width: '50%',
                  },
                },
              ],
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
                    description: 'Total stage-executions to process',
                    width: '34%',
                  },
                },
                {
                  name: 'completed',
                  type: 'number',
                  label: 'Completed',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Stage-executions successfully completed',
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
                    description: 'Stage-executions that failed',
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
            {
              name: 'videoProgress',
              type: 'json',
              label: 'Video Progress',
              admin: {
                readOnly: true,
                description: 'Maps video IDs to last completed stage name. Example: { "42": "scene_detection", "43": "transcription" }',
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
