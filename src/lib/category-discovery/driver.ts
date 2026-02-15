import type { CategoryDiscoveryDriver } from './types'
import { dmDriver } from './drivers/dm'
import { rossmannDriver } from './drivers/rossmann'
import { muellerDriver } from './drivers/mueller'

const drivers: CategoryDiscoveryDriver[] = [dmDriver, rossmannDriver, muellerDriver]

export function getCategoryDriver(url: string): CategoryDiscoveryDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}
