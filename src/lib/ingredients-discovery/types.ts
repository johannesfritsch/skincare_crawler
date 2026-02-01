import type { Payload } from 'payload'

export interface DiscoveryStats {
  discovered: number
  created: number
  existing: number
  errors: number
}

export interface DiscoveryDriver {
  // Check if this driver handles the given URL
  matches(url: string): boolean

  // Initialize the term queue (e.g., ["*"] for CosIng)
  getInitialTermQueue(): string[]

  // Process a single term - returns sub-terms if splitting needed, or null if should process pages
  checkTerm(term: string): Promise<{ split: true; subTerms: string[] } | { split: false; totalPages: number }>

  // Fetch and process a single page, returns stats delta
  processPage(term: string, page: number, payload: Payload): Promise<DiscoveryStats>
}
