export interface DiscoveryStats {
  discovered: number
  created: number
  existing: number
  errors: number
}

/** Pure ingredient data returned by fetchPage — no DB dependency */
export interface ScrapedIngredientData {
  name: string
  casNumber?: string
  ecNumber?: string
  cosIngId?: string
  chemicalDescription?: string
  functions: string[]
  itemType?: 'ingredient' | 'substance'
  restrictions?: string
  sourceUrl?: string
}

export interface DiscoveryDriver {
  // Check if this driver handles the given URL
  matches(url: string): boolean

  // Initialize the term queue (e.g., ["*"] for CosIng)
  getInitialTermQueue(): string[]

  // Process a single term - returns sub-terms if splitting needed, or null if should process pages
  checkTerm(term: string): Promise<{ split: true; subTerms: string[] } | { split: false; totalPages: number }>

  // Pure fetch: returns ingredient data without DB writes
  fetchPage(term: string, page: number): Promise<ScrapedIngredientData[]>
}
