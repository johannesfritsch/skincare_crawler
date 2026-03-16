/**
 * Central server-side store registry.
 *
 * When adding a new store driver, add a new entry to STORES.
 * Everything else (SOURCE_OPTIONS, STORE_LABELS, detectStoreFromUrl, etc.)
 * derives automatically.
 */

/** Full store definition — single source of truth for the server process */
export const STORES = [
  { value: 'dm', label: 'DM', hosts: ['www.dm.de', 'dm.de'] },
  { value: 'rossmann', label: 'Rossmann', hosts: ['www.rossmann.de', 'rossmann.de'] },
  { value: 'mueller', label: 'Müller', hosts: ['www.mueller.de', 'mueller.de'] },
  { value: 'purish', label: 'PURISH', hosts: ['purish.com', 'www.purish.com', 'purish.de', 'www.purish.de'] },
] as const

// ── Derived constants (used by collection configs, components, etc.) ──

/** Store source options for Payload select fields (label + value only) */
export const SOURCE_OPTIONS = STORES.map(({ label, value }) => ({ label, value }))

/** Store source options with an "All Stores" option prepended */
export const SOURCE_OPTIONS_WITH_ALL = [
  { label: 'All Stores' as const, value: 'all' as const },
  ...SOURCE_OPTIONS,
]

/** All source slugs as a plain string array */
export const ALL_SOURCE_SLUGS = STORES.map((s) => s.value)

/** Default image source priority for product aggregation */
export const DEFAULT_IMAGE_SOURCE_PRIORITY = STORES.map((s) => s.value)

/** Default brand source priority for product aggregation (rossmann → purish → dm → mueller) */
export const DEFAULT_BRAND_SOURCE_PRIORITY = ['rossmann', 'purish', 'dm', 'mueller']

/** Map source slug → display label */
export const STORE_LABELS: Record<string, string> = Object.fromEntries(
  STORES.map((s) => [s.value, s.label]),
)

// ── URL utilities ──

/** Reverse map: hostname → source slug (derived from STORES) */
const HOST_TO_SLUG: Record<string, string> = Object.fromEntries(
  STORES.flatMap((s) => s.hosts.map((h) => [h, s.value])),
)

/** Detect source slug from a URL's hostname. Returns null if unknown. */
export function detectStoreFromUrl(url: string): string | null {
  try {
    return HOST_TO_SLUG[new URL(url).hostname] ?? null
  } catch {
    return null
  }
}

/** Shorten a URL for display: strip protocol and trailing slash */
export function shortenUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}
