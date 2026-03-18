import { postgresAdapter } from '@payloadcms/db-postgres'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, type Plugin } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { ProductMedia } from './collections/ProductMedia'
import { VideoMedia } from './collections/VideoMedia'
import { ProfileMedia } from './collections/ProfileMedia'
import { DetectionMedia } from './collections/DetectionMedia'
import { Brands } from './collections/Brands'
import { ProductTypes } from './collections/ProductTypes'
import { Ingredients } from './collections/Ingredients'
import { IngredientsDiscoveries } from './collections/IngredientsDiscoveries'
import { Products } from './collections/Products'
import { ProductVariants } from './collections/ProductVariants'
import { SourceProducts } from './collections/SourceProducts'
import { SourceBrands } from './collections/SourceBrands'
import { SourceVariants } from './collections/SourceVariants'
import { SourceReviews } from './collections/SourceReviews'
import { ProductSentiments } from './collections/ProductSentiments'

import { ProductDiscoveries } from './collections/ProductDiscoveries'
import { ProductSearches } from './collections/ProductSearches'
import { ProductCrawls } from './collections/ProductCrawls'
import { ProductAggregations } from './collections/ProductAggregations'
import { IngredientCrawls } from './collections/IngredientCrawls'
import { Events } from './collections/Events'
import { Creators } from './collections/Creators'
import { Channels } from './collections/Channels'
import { Videos } from './collections/Videos'
import { VideoScenes } from './collections/VideoScenes'
import { VideoFrames } from './collections/VideoFrames'
import { VideoMentions } from './collections/VideoMentions'
import { VideoDiscoveries } from './collections/VideoDiscoveries'
import { VideoCrawls } from './collections/VideoCrawls'
import { VideoProcessings } from './collections/VideoProcessings'

import { Workers } from './collections/Workers'

import { dashboardEventsHandler } from './endpoints/dashboard-events'
import { dashboardSnapshotHandler } from './endpoints/dashboard-snapshot'
import { embeddingsWriteHandler, embeddingsSearchHandler, embeddingsDeleteHandler } from './endpoints/embeddings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/* ------------------------------------------------------------------ */
/*  Storage                                                            */
/* ------------------------------------------------------------------ */

const plugins: Plugin[] = []

if (process.env.STORAGE_ADAPTER === 's3') {
  plugins.push(
    s3Storage({
      collections: {
        'product-media': true,
        'video-media': true,
        'profile-media': true,
        'detection-media': true,
      },
      bucket: process.env.S3_BUCKET || '',
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
        region: process.env.S3_REGION || 'us-east-1',
        // Support non-AWS S3-compatible services (MinIO, etc.)
        ...(process.env.S3_ENDPOINT
          ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
          : {}),
      },
    }),
  )
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      graphics: {
        Icon: '/components/graphics/Icon',
        Logo: '/components/graphics/Logo',
      },
      beforeDashboard: ['/components/dashboard/DashboardProvider'],
    },
    dashboard: {
      widgets: [
        {
          slug: 'event-summary',
          label: 'Summary',
          ComponentPath: '/components/dashboard/widgets/EventSummary',
          minWidth: 'medium',
          maxWidth: 'full',
        },
        {
          slug: 'event-timeline',
          label: 'Event Timeline',
          ComponentPath: '/components/dashboard/widgets/EventTimeline',
          minWidth: 'large',
          maxWidth: 'full',
        },
        {
          slug: 'event-highlights',
          label: 'Operational Highlights',
          ComponentPath: '/components/dashboard/widgets/EventHighlights',
          minWidth: 'small',
          maxWidth: 'large',
        },
        {
          slug: 'event-sources',
          label: 'Activity by Store',
          ComponentPath: '/components/dashboard/widgets/EventSources',
          minWidth: 'small',
          maxWidth: 'large',
        },
        {
          slug: 'event-domains',
          label: 'Activity by Domain',
          ComponentPath: '/components/dashboard/widgets/EventDomains',
          minWidth: 'small',
          maxWidth: 'large',
        },
        {
          slug: 'event-jobs',
          label: 'Job Activity',
          ComponentPath: '/components/dashboard/widgets/EventJobs',
          minWidth: 'medium',
          maxWidth: 'full',
        },
        {
          slug: 'event-errors',
          label: 'Recent Errors',
          ComponentPath: '/components/dashboard/widgets/EventErrors',
          minWidth: 'large',
          maxWidth: 'full',
        },
        {
          slug: 'ingredient-stats',
          label: 'Ingredient Stats',
          ComponentPath: '/components/dashboard/widgets/IngredientStats',
          minWidth: 'small',
          maxWidth: 'large',
        },
        {
          slug: 'database-overview',
          label: 'Database Overview',
          ComponentPath: '/components/dashboard/widgets/DatabaseOverview',
          minWidth: 'medium',
          maxWidth: 'full',
        },
        {
          slug: 'product-quality',
          label: 'Product Data Quality',
          ComponentPath: '/components/dashboard/widgets/ProductQuality',
          minWidth: 'small',
          maxWidth: 'large',
        },
        {
          slug: 'source-coverage',
          label: 'Source Coverage',
          ComponentPath: '/components/dashboard/widgets/SourceCoverage',
          minWidth: 'medium',
          maxWidth: 'full',
        },
        {
          slug: 'video-pipeline',
          label: 'Video Pipeline',
          ComponentPath: '/components/dashboard/widgets/VideoPipeline',
          minWidth: 'small',
          maxWidth: 'large',
        },
        {
          slug: 'job-queue',
          label: 'Job Queue & Workers',
          ComponentPath: '/components/dashboard/widgets/JobQueue',
          minWidth: 'medium',
          maxWidth: 'full',
        },
      ],
      defaultLayout: [
        { widgetSlug: 'database-overview', width: 'full' },
        { widgetSlug: 'event-summary', width: 'full' },
        { widgetSlug: 'event-timeline', width: 'full' },
        { widgetSlug: 'event-highlights', width: 'full' },
        { widgetSlug: 'source-coverage', width: 'medium' },
        { widgetSlug: 'product-quality', width: 'medium' },
        { widgetSlug: 'ingredient-stats', width: 'medium' },
        { widgetSlug: 'video-pipeline', width: 'medium' },
        { widgetSlug: 'event-sources', width: 'medium' },
        { widgetSlug: 'event-domains', width: 'medium' },
        { widgetSlug: 'job-queue', width: 'full' },
        { widgetSlug: 'event-jobs', width: 'large' },
        { widgetSlug: 'event-errors', width: 'full' },
      ],
    },
  },
  collections: [
    Users,
    ProductMedia,
    VideoMedia,
    ProfileMedia,
    DetectionMedia,
    Brands,
    ProductTypes,
    Ingredients,
    IngredientsDiscoveries,
    IngredientCrawls,
    Products,
    ProductVariants,
    SourceProducts,
    SourceBrands,
    SourceVariants,
    SourceReviews,
    ProductDiscoveries,
    ProductSearches,
    ProductCrawls,
    ProductAggregations,
    ProductSentiments,
    Events,
    Creators,
    Channels,
    Videos,
    VideoScenes,
    VideoFrames,
    VideoMentions,
    VideoDiscoveries,
    VideoCrawls,
    VideoProcessings,
    Workers,
  ],
  endpoints: [
    {
      path: '/dashboard/events',
      method: 'get',
      handler: dashboardEventsHandler,
    },
    {
      path: '/dashboard/snapshot',
      method: 'get',
      handler: dashboardSnapshotHandler,
    },
    {
      path: '/embeddings/:namespace/write',
      method: 'post',
      handler: embeddingsWriteHandler,
    },
    {
      path: '/embeddings/:namespace/search',
      method: 'get',
      handler: embeddingsSearchHandler,
    },
    {
      path: '/embeddings/:namespace/delete',
      method: 'post',
      handler: embeddingsDeleteHandler,
    },
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    extensions: ['vector'],
    push: false,
  }),
  sharp,
  plugins,
})
