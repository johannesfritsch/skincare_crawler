import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Brands } from './collections/Brands'
import { Categories } from './collections/Categories'
import { Ingredients } from './collections/Ingredients'
import { IngredientsDiscoveries } from './collections/IngredientsDiscoveries'
import { Products } from './collections/Products'
import { SourceProducts } from './collections/SourceProducts'
import { ProductDiscoveries } from './collections/ProductDiscoveries'
import { ProductCrawls } from './collections/ProductCrawls'
import { ProductAggregations } from './collections/ProductAggregations'
import { Events } from './collections/Events'
import { Creators } from './collections/Creators'
import { Channels } from './collections/Channels'
import { Videos } from './collections/Videos'
import { VideoSnippets } from './collections/VideoSnippets'
import { VideoDiscoveries } from './collections/VideoDiscoveries'
import { VideoProcessings } from './collections/VideoProcessings'
import { CategoryDiscoveries } from './collections/CategoryDiscoveries'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Brands, Categories, Ingredients, IngredientsDiscoveries, Products, SourceProducts, ProductDiscoveries, ProductCrawls, ProductAggregations, CategoryDiscoveries, Events, Creators, Channels, Videos, VideoSnippets, VideoDiscoveries, VideoProcessings],
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
  plugins: [],
})
