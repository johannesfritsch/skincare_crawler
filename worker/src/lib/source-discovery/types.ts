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
  debug?: boolean // keep browser visible (non-headless)
}

export interface ProductDiscoveryResult {
  done: boolean
  pagesUsed: number
}

/** Pure scraped data returned by scrapeProduct — no DB dependency */
export interface ScrapedProductData {
  gtin?: string
  name: string
  brandName?: string
  description?: string
  ingredientNames: string[]
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
    }>
  }>
  labels?: string[]
  rating?: number
  ratingNum?: number
  sourceArticleNumber?: string
  categoryBreadcrumbs?: string[]
  categoryUrl?: string
  canonicalUrl?: string
  perUnitAmount?: number
  perUnitQuantity?: number
  perUnitUnit?: string
  warnings: string[]
}

export type SourceSlug = 'dm' | 'mueller' | 'rossmann'

export interface SourceDriver {
  slug: SourceSlug
  label: string
  /** Inline SVG markup for the store logo (used in frontend UI) */
  logoSvg: string

  matches(url: string): boolean

  discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult>

  scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean },
  ): Promise<ScrapedProductData | null>
}
