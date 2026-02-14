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
}

export type SourceSlug = 'dm' | 'mueller' | 'rossmann'

export interface SourceDriver {
  slug: SourceSlug
  label: string      // e.g., 'DM' (for admin UI)

  // Check if this driver handles the given URL
  matches(url: string): boolean

  // Discover all products from a category URL (API-based)
  // Returns the products found and total count
  discoverProducts(
    url: string,
  ): Promise<{ totalCount: number; products: DiscoveredProduct[] }>

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
