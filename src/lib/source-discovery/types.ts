import type { Payload } from 'payload'

export interface DiscoveryStats {
  itemsDiscovered: number
  itemsCrawled: number
  itemsFailed: number
}

export interface DiscoveredProduct {
  gtin: string
  productUrl: string | null
  brandName?: string
  name?: string
  price?: number       // cents
  currency?: string
  rating?: number
  ratingCount?: number
  category?: string    // "Make-up -> Augen -> Lidschatten Primer & Base"
}

export interface SourceDriver {
  slug: string       // e.g., 'dm'
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
    gtin: string,
    payload: Payload,
  ): Promise<number | null>

  // Collection-query methods
  findUncrawledProducts(
    payload: Payload,
    options: { gtins?: string[]; limit: number },
  ): Promise<Array<{ id: number; gtin: string; sourceUrl: string | null }>>

  markProductStatus(payload: Payload, productId: number, status: 'crawled' | 'failed'): Promise<void>

  countUncrawled(payload: Payload, options?: { gtins?: string[] }): Promise<number>

  resetProducts(payload: Payload, gtins?: string[], crawledBefore?: Date): Promise<void>
}
