import { postgresAdapter } from '@payloadcms/db-postgres'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, type Plugin } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Brands } from './collections/Brands'
import { ProductTypes } from './collections/ProductTypes'
import { Ingredients } from './collections/Ingredients'
import { IngredientsDiscoveries } from './collections/IngredientsDiscoveries'
import { Products } from './collections/Products'
import { ProductVariants } from './collections/ProductVariants'
import { SourceProducts } from './collections/SourceProducts'
import { SourceVariants } from './collections/SourceVariants'

import { ProductDiscoveries } from './collections/ProductDiscoveries'
import { ProductSearches } from './collections/ProductSearches'
import { ProductCrawls } from './collections/ProductCrawls'
import { ProductAggregations } from './collections/ProductAggregations'
import { IngredientCrawls } from './collections/IngredientCrawls'
import { Events } from './collections/Events'
import { Creators } from './collections/Creators'
import { Channels } from './collections/Channels'
import { Videos } from './collections/Videos'
import { VideoSnippets } from './collections/VideoSnippets'
import { VideoMentions } from './collections/VideoMentions'
import { VideoDiscoveries } from './collections/VideoDiscoveries'
import { VideoProcessings } from './collections/VideoProcessings'

import { Workers } from './collections/Workers'

import { dashboardEventsHandler } from './endpoints/dashboard-events'
import { dashboardSnapshotHandler } from './endpoints/dashboard-snapshot'
import { embeddingsWriteHandler, embeddingsSearchHandler } from './endpoints/embeddings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/* ------------------------------------------------------------------ */
/*  Storage                                                            */
/* ------------------------------------------------------------------ */

const plugins: Plugin[] = []

if (process.env.STORAGE_ADAPTER === 's3') {
  plugins.push(
    s3Storage({
      collections: { media: true },
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
    Media,
    Brands,
    ProductTypes,
    Ingredients,
    IngredientsDiscoveries,
    IngredientCrawls,
    Products,
    ProductVariants,
    SourceProducts,
    SourceVariants,
    ProductDiscoveries,
    ProductSearches,
    ProductCrawls,
    ProductAggregations,
    Events,
    Creators,
    Channels,
    Videos,
    VideoSnippets,
    VideoMentions,
    VideoDiscoveries,
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
