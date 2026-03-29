/**
 * Runtime validation for scraped product data using JSON Schema.
 *
 * Each driver has a schema.json co-located with its index.ts that defines
 * what valid ScrapedProductData looks like for that store. Schemas are
 * compiled once at import time via ajv.
 *
 * Validation is a monitoring layer, not a gate — the crawl still succeeds
 * even with issues. Issues are reported as structured errors with JSON
 * pointer paths to the failing field.
 */
import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

// Import schemas directly — works with both tsx and vitest's module resolver
import dmSchema from '@/lib/source-discovery/drivers/dm/schema.json'
import rossmannSchema from '@/lib/source-discovery/drivers/rossmann/schema.json'
import muellerSchema from '@/lib/source-discovery/drivers/mueller/schema.json'
import purishSchema from '@/lib/source-discovery/drivers/purish/schema.json'
import douglasSchema from '@/lib/source-discovery/drivers/douglas/schema.json'
import shopapothekeSchema from '@/lib/source-discovery/drivers/shopapotheke/schema.json'

export interface ValidationIssue {
  field: string
  rule: string
  message: string
}

// Set up ajv with all errors + URI format support
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)

// Compile schemas once at import time
const validators: Record<string, ValidateFunction> = {
  dm: ajv.compile(dmSchema),
  rossmann: ajv.compile(rossmannSchema),
  mueller: ajv.compile(muellerSchema),
  purish: ajv.compile(purishSchema),
  douglas: ajv.compile(douglasSchema),
  shopapotheke: ajv.compile(shopapothekeSchema),
}

/**
 * Validate scraped product data against the driver's JSON Schema.
 * Returns an array of issues — empty means valid.
 */
export function validateCrawlResult(data: unknown, source: string): ValidationIssue[] {
  const validate = validators[source]
  if (!validate) return [] // no schema for this driver

  validate(data)
  if (!validate.errors) return []

  return validate.errors.map((err) => ({
    field: err.instancePath || (err.params as Record<string, string>)?.missingProperty || 'unknown',
    rule: err.keyword ?? 'unknown',
    message: err.message ?? 'validation failed',
  }))
}

/** Get the list of driver slugs that have schemas loaded */
export function getValidatedDrivers(): string[] {
  return Object.keys(validators)
}
