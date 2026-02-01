import type { DmDiscoveryDriver } from './types'
import { dmDriver } from './drivers/dm'

const drivers: DmDiscoveryDriver[] = [dmDriver]

export function getDmDriver(url: string): DmDiscoveryDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}
