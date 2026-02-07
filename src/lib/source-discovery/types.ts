import type { Payload } from 'payload'
import type { Page } from 'playwright-core'

export interface DiscoveryStats {
  itemsDiscovered: number
  itemsCrawled: number
  itemsFailed: number
}

export interface DiscoveredProduct {
  gtin: string
  productUrl: string | null
}

export interface SourceDriver {
  // Check if this driver handles the given URL
  matches(url: string): boolean

  // Discover all products from a category page (browser-based)
  // Returns the products found and total count reported by the site
  discoverProducts(
    page: Page,
    url: string,
  ): Promise<{ totalCount: number; products: DiscoveredProduct[] }>

  // Crawl a single product and save to database
  // Returns the product ID if successful, null if failed
  crawlProduct(
    page: Page,
    gtin: string,
    productUrl: string | null,
    payload: Payload,
  ): Promise<number | null>

  // Accept cookies on the page
  acceptCookies(page: Page): Promise<void>

  // Get the base URL for this driver (for initial navigation)
  getBaseUrl(): string
}
