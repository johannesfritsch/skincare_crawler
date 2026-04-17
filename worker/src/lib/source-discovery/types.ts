export interface DiscoveryStats {
  itemsDiscovered: number
  itemsCrawled: number
  itemsFailed: number
}

export interface DiscoveredProduct {
  gtin?: string
  productUrl: string
  brandName?: string
  name?: string
  rating?: number
  ratingCount?: number
  category?: string    // "Make-up -> Augen -> Lidschatten Primer & Base"
  categoryUrl?: string  // URL of the category page from discovery
}

export interface ProductDiscoveryOptions {
  url: string
  onProduct: (product: DiscoveredProduct) => Promise<void>
  onError?: (url: string) => void
  onProgress?: (progress: unknown) => Promise<void>
  progress?: unknown
  maxPages?: number
  delay?: number  // ms between requests, default 2000
  debug?: boolean // keep browser visible (non-headless)
  /** Job-scoped logger for event emission. Drivers use their own console logger if not provided. */
  logger?: import('@/lib/logger').Logger
  /** Debug context for screenshot capture */
  debugContext?: {
    client: import('@/lib/payload-client').PayloadRestClient
    jobCollection: 'product-crawls' | 'product-discoveries' | 'product-searches'
    jobId: number
  }
}

export interface ProductDiscoveryResult {
  done: boolean
  pagesUsed: number
}

/** Pure scraped data returned by scrapeProduct — no DB dependency */
export interface ScrapedProductData {
  gtin?: string
  pzn?: string
  name: string
  brandName?: string
  brandUrl?: string
  brandImageUrl?: string
  description?: string
  ingredientsText?: string
  priceCents?: number
  currency?: string
  priceInfos?: string[]
  amount?: number
  amountUnit?: string
  images: Array<{ url: string; alt?: string | null }>
  variants: Array<{
    dimension: string
    options: Array<{
      label: string
      value: string | null
      gtin: string | null
      isSelected: boolean
      availability?: 'available' | 'unavailable' | 'unknown'
      sourceArticleNumber?: string | null
    }>
  }>
  labels?: string[]
  rating?: number
  ratingCount?: number
  sourceArticleNumber?: string
  sourceProductArticleNumber?: string
  categoryBreadcrumbs?: string[]
  categoryUrl?: string
  canonicalUrl?: string
  perUnitAmount?: number
  perUnitQuantity?: number
  perUnitUnit?: string
  availability?: 'available' | 'unavailable' | 'unknown'
  warnings: string[]
  reviews?: Array<{
    externalId: string
    rating: number
    title?: string
    reviewText?: string
    userNickname?: string
    submittedAt?: string
    isRecommended?: boolean | null
    positiveFeedbackCount?: number
    negativeFeedbackCount?: number
    reviewerAge?: string
    reviewerGender?: string
    reviewSource?: string
  }>
}

export interface ProductSearchOptions {
  query: string
  maxResults?: number   // max products to return (default: 50)
  debug?: boolean       // keep browser visible (non-headless)
  /** When true, query is a GTIN and drivers should filter results to exact GTIN matches only */
  isGtinSearch?: boolean
  /** Job-scoped logger for event emission */
  logger?: import('@/lib/logger').Logger
  /** Debug context for screenshot-on-error */
  debugContext?: {
    client: import('@/lib/payload-client').PayloadRestClient
    jobCollection: 'product-crawls' | 'product-discoveries' | 'product-searches'
    jobId: number
  }
}

export interface ProductSearchResult {
  products: DiscoveredProduct[]
}

export type SourceSlug = 'dm' | 'mueller' | 'rossmann' | 'purish' | 'douglas' | 'shopapotheke' | 'kaufland'

export interface SourceDriver {
  slug: SourceSlug
  label: string
  /** Hostnames this driver handles (e.g. ['www.dm.de', 'dm.de']) */
  hosts: string[]
  /** Inline SVG markup for the store logo (used in frontend UI) */
  logoSvg: string

  matches(url: string): boolean

  discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult>

  searchProducts(
    options: ProductSearchOptions,
  ): Promise<ProductSearchResult>

  scrapeProduct(
    sourceUrl: string,
    options?: {
      debug?: boolean
      logger?: import('@/lib/logger').Logger
      skipReviews?: boolean
      debugContext?: {
        client: import('@/lib/payload-client').PayloadRestClient
        jobCollection: 'product-crawls' | 'product-discoveries' | 'product-searches'
        jobId: number
      }
    },
  ): Promise<ScrapedProductData | null>
}
