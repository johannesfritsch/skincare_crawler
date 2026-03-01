/**
 * Central definition of store source options for Payload select fields.
 *
 * When adding a new store driver, add a new entry to SOURCE_OPTIONS.
 * All collections that reference stores (SourceProducts, ProductCrawls,
 * ProductSearches, SearchResults, ProductAggregations) import from here.
 */

/** Store source options for select fields (value = driver slug, label = display name) */
export const SOURCE_OPTIONS = [
  { label: 'DM', value: 'dm' },
  { label: 'Rossmann', value: 'rossmann' },
  { label: 'Müller', value: 'mueller' },
] as const

/** Store source options with an "All Stores" option prepended */
export const SOURCE_OPTIONS_WITH_ALL = [
  { label: 'All Stores', value: 'all' },
  ...SOURCE_OPTIONS,
] as const

/** All source slugs as a plain string array (for defaultValue on multi-select fields) */
export const ALL_SOURCE_SLUGS = SOURCE_OPTIONS.map((o) => o.value)

/** Default image source priority for product aggregation (first source with images wins) */
export const DEFAULT_IMAGE_SOURCE_PRIORITY = SOURCE_OPTIONS.map((o) => o.value)

/** Map source slug to display label */
export const STORE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((o) => [o.value, o.label]),
)
