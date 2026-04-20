import type { GalleryDiscoveryDriver } from './types'
import { instagramGalleryDriver } from './drivers/instagram'

const drivers: GalleryDiscoveryDriver[] = [instagramGalleryDriver]

export function getGalleryDriver(url: string): GalleryDiscoveryDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}
