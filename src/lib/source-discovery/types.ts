import type { Payload } from 'payload'

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
  price?: number       // cents
  currency?: string
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
}

export interface ProductDiscoveryResult {
  done: boolean
  pagesUsed: number
}

export type SourceSlug = 'dm' | 'mueller' | 'rossmann'

export interface SourceDriver {
  slug: SourceSlug
  label: string      // e.g., 'DM' (for admin UI)

  // Check if this driver handles the given URL
  matches(url: string): boolean

  // Discover products from a category URL with callbacks for incremental saving
  discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult>

  // Crawl a single product via API and save to database
  // Returns the product ID if successful, null if failed
  crawlProduct(
    sourceUrl: string,
    payload: Payload,
    options?: { debug?: boolean },
  ): Promise<number | null>

  // Collection-query methods
  findUncrawledProducts(
    payload: Payload,
    options: { sourceUrls?: string[]; limit: number },
  ): Promise<Array<{ id: number; sourceUrl: string; gtin?: string }>>

  markProductStatus(payload: Payload, productId: number, status: 'crawled' | 'failed'): Promise<void>

  countUncrawled(payload: Payload, options?: { sourceUrls?: string[] }): Promise<number>

  resetProducts(payload: Payload, sourceUrls?: string[], crawledBefore?: Date): Promise<void>
}
