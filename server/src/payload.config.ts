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
import { SourceProducts } from './collections/SourceProducts'
import { SourceVariants } from './collections/SourceVariants'

import { ProductDiscoveries } from './collections/ProductDiscoveries'
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

import { CrawlResults } from './collections/CrawlResults'
import { DiscoveryResults } from './collections/DiscoveryResults'
import { Workers } from './collections/Workers'

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
  },
  collections: [Users, Media, Brands, ProductTypes, Ingredients, IngredientsDiscoveries, IngredientCrawls, Products, SourceProducts, SourceVariants, ProductDiscoveries, ProductCrawls, ProductAggregations, CrawlResults, DiscoveryResults, Events, Creators, Channels, Videos, VideoSnippets, VideoMentions, VideoDiscoveries, VideoProcessings, Workers],
  endpoints: [],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
  }),
  sharp,
  plugins,
})
