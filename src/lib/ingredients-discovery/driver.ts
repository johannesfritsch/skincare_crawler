import type { DiscoveryDriver } from './types'
import { cosIngDriver } from './drivers/cosing'

const drivers: DiscoveryDriver[] = [
  cosIngDriver,
]

export function getDriver(url: string): DiscoveryDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}
