import type { SourceDriver } from './types'
import { dmDriver } from './drivers/dm'

const drivers: SourceDriver[] = [dmDriver]

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
