import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFieldsNoMax, jobClaimProgressFields, jobProgressFields, DEFAULT_MAX_RETRIES } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'
import { deleteWorkItems } from '@/hooks/deleteWorkItems'

export const GalleryProcessings: CollectionConfig = {
  slug: 'gallery-processings',
  labels: {
    singular: 'Gallery Processing',
    plural: 'Gallery Processings',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'completed', 'errors', 'startedAt'],
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
        tokensUsed: 0,
        tokensRecognition: 0,
        tokensSentiment: 0,
        galleryProgress: null,
      }),
    ],
    afterChange: [
      rescheduleOnComplete,
    ],
    afterDelete: [deleteWorkItems('gallery-processings')],
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
              label: 'Type',
              required: true,
              defaultValue: 'all_unprocessed',
              options: [
                { label: 'All Unprocessed', value: 'all_unprocessed' },
                { label: 'Single Gallery', value: 'single_gallery' },
                { label: 'Selected URLs', value: 'selected_urls' },
                { label: 'From Crawl Job', value: 'from_crawl' },
              ],
            },
            {
              name: 'gallery',
              type: 'relationship',
              relationTo: 'galleries',
              label: 'Gallery',
              admin: {
                description: 'The gallery to process',
                condition: (data) => data?.type === 'single_gallery',
              },
            },
            {
              name: 'urls',
              type: 'textarea',
              label: 'URLs',
              admin: {
                description: 'Gallery or channel URLs to process, one per line',
                condition: (data) => data?.type === 'selected_urls',
              },
            },
            {
              name: 'crawl',
              type: 'relationship',
              relationTo: 'gallery-crawls',
              label: 'Crawl Job',
              admin: {
                description: 'Process the galleries crawled by this crawl job.',
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
                  name: 'stageBarcodeScan',
                  type: 'checkbox',
                  label: 'Barcode Scan',
                  defaultValue: true,
                  admin: {
                    description: 'Scan images for EAN barcodes, resolve to products.',
                    width: '33%',
                  },
                },
                {
                  name: 'stageObjectDetection',
                  type: 'checkbox',
                  label: 'Object Detection',
                  defaultValue: true,
                  admin: {
                    description: 'Grounding DINO zero-shot object detection on gallery images.',
                    width: '33%',
                  },
                },
                {
                  name: 'stageOcrExtraction',
                  type: 'checkbox',
                  label: 'OCR Extraction',
                  defaultValue: true,
                  admin: {
                    description: 'Read text from detection crops via GPT-4.1-mini vision.',
                    width: '33%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'stageVisualSearch',
                  type: 'checkbox',
                  label: 'Visual Search',
                  defaultValue: true,
                  admin: {
                    description: 'DINOv2 visual similarity search against product embeddings (top-N candidates per crop).',
                    width: '33%',
                  },
                },
                {
                  name: 'stageCompileDetections',
                  type: 'checkbox',
                  label: 'Compile Detections',
                  defaultValue: true,
                  admin: {
                    description: 'Synthesize all detection sources into unified detections.',
                    width: '33%',
                  },
                },
                {
                  name: 'stageSentimentAnalysis',
                  type: 'checkbox',
                  label: 'Sentiment Analysis',
                  defaultValue: true,
                  admin: {
                    description: 'LLM quote extraction and sentiment scoring from captions.',
                    width: '33%',
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
              name: 'maxRetries',
              type: 'number',
              label: 'Max Retries',
              defaultValue: DEFAULT_MAX_RETRIES,
              admin: {
                description: 'Maximum number of retries before the job is marked as failed. Set to 0 to disable retries.',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'detectionThreshold',
                  type: 'number',
                  label: 'Detection Threshold',
                  defaultValue: 0.3,
                  min: 0.01,
                  max: 1,
                  admin: {
                    description: 'Grounding DINO confidence threshold (0-1). Detections below this score are discarded. Default: 0.3.',
                    width: '50%',
                  },
                },
                {
                  name: 'minBoxArea',
                  type: 'number',
                  label: 'Min Box Area (%)',
                  defaultValue: 25,
                  min: 0,
                  max: 100,
                  admin: {
                    description:
                      'Minimum detection box area as a percentage of the image area. ' +
                      'Detections smaller than this are discarded as background noise. Default: 25%.',
                    width: '50%',
                  },
                },
              ],
            },
            {
              name: 'detectionPrompt',
              type: 'text',
              label: 'Detection Prompt',
              defaultValue: 'cosmetics packaging.',
              admin: {
                description:
                  'Grounding DINO text prompt for zero-shot object detection. Default: "cosmetics packaging."',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'searchThreshold',
                  type: 'number',
                  label: 'Search Threshold',
                  defaultValue: 0.8,
                  min: 0.01,
                  max: 2,
                  admin: {
                    description:
                      'Maximum cosine distance for DINOv2 similarity search (0-2). ' +
                      'Pre-filter on pgvector query. Default: 0.8.',
                    width: '50%',
                  },
                },
                {
                  name: 'searchLimit',
                  type: 'number',
                  label: 'Search Limit',
                  defaultValue: 3,
                  min: 1,
                  max: 20,
                  admin: {
                    description:
                      'Number of nearest neighbor candidates to store per detection crop. ' +
                      'All candidates are passed to the LLM consolidation stage. Default: 3.',
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
            ...jobClaimProgressFields,
            ...jobProgressFields,
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
                    width: '25%',
                  },
                },
                {
                  name: 'tokensRecognition',
                  type: 'number',
                  label: 'Recognition Tokens',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
                {
                  name: 'tokensSentiment',
                  type: 'number',
                  label: 'Sentiment Tokens',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
              ],
            },
            {
              name: 'galleryProgress',
              type: 'json',
              label: 'Gallery Progress',
              admin: {
                readOnly: true,
                description: 'Maps gallery IDs to last completed stage name. Example: { "42": "barcode_scan", "43": "compile_detections" }',
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
