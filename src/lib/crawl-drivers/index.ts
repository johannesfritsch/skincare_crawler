import { dmDriver } from './dm'
import type { CrawlDriver } from './types'

// Registry of all available drivers
const drivers: CrawlDriver[] = [dmDriver]

// Map of hostname to driver for fast lookup
const hostnameMap = new Map<string, CrawlDriver>()

// Build the hostname map
for (const driver of drivers) {
  for (const hostname of driver.hostnames) {
    hostnameMap.set(hostname.toLowerCase(), driver)
  }
}

/**
 * Get a driver by URL - extracts hostname and finds matching driver
 */
export function getDriverByUrl(url: string): CrawlDriver | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostnameMap.get(hostname) || null
  } catch {
    return null
  }
}

/**
 * Get a driver by its ID
 */
export function getDriverById(id: string): CrawlDriver | null {
  return drivers.find((d) => d.id === id) || null
}

/**
 * Get all available drivers
 */
export function getAllDrivers(): CrawlDriver[] {
  return [...drivers]
}

/**
 * Get all supported hostnames
 */
export function getSupportedHostnames(): string[] {
  return Array.from(hostnameMap.keys())
}

export type { CrawlDriver, DiscoveredProduct, DiscoveryResult, ProductData } from './types'
