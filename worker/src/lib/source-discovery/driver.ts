import type { SourceDriver, SourceSlug } from './types'
import { dmDriver } from './drivers/dm'
import { rossmannDriver } from './drivers/rossmann'
import { muellerDriver } from './drivers/mueller'

const drivers: SourceDriver[] = [dmDriver, rossmannDriver, muellerDriver]

/** All registered source slugs, derived from the driver registry */
export const ALL_SOURCE_SLUGS: SourceSlug[] = drivers.map((d) => d.slug)

/**
 * Default priority order for selecting product images during aggregation.
 * First source with images wins. Matches driver registration order.
 */
export const DEFAULT_IMAGE_SOURCE_PRIORITY: string[] = drivers.map((d) => d.slug)

export function getSourceDriver(url: string): SourceDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}

export function getSourceDriverBySlug(slug: string): SourceDriver | null {
  return drivers.find((d) => d.slug === slug) ?? null
}

export function getAllSourceDrivers(): SourceDriver[] {
  return drivers
}
