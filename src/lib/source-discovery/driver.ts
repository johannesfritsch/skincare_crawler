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
