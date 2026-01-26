import type { Payload, CollectionSlug } from 'payload'
import type { Page } from 'playwright-core'

export interface DiscoveredProduct {
  gtin: string
  productUrl: string | null
}

export interface DiscoveryResult {
  totalCount: number
  products: DiscoveredProduct[]
}

export interface ProductData {
  gtin: string
  brandName: string | null
  name: string
  price: number | null
  pricePerUnit: string | null
  pricePerValue: number | null
  rating: number | null
  ratingNum: number | null
  labels: string[]
  ingredients: string[]
  sourceUrl: string | null
}

export interface CrawlDriver {
  // Unique identifier for this driver
  id: string

  // Human-readable name
  name: string

  // Hostnames this driver handles (e.g., ['www.dm.de', 'dm.de'])
  hostnames: string[]

  // Collection names used by this driver
  collections: {
    products: CollectionSlug
    crawls: CollectionSlug
    crawlItems: CollectionSlug
  }

  // Accept cookies on the page
  acceptCookies(page: Page): Promise<void>

  // Discover products from a category/listing URL
  discoverProducts(page: Page, url: string): Promise<DiscoveryResult>

  // Scrape a single product by URL (preferred) or GTIN fallback
  scrapeProduct(page: Page, gtin: string | null, productUrl: string | null): Promise<ProductData | null>

  // Save product data to the database
  saveProduct(payload: Payload, data: ProductData): Promise<number>
}
