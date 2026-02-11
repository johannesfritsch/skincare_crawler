import type { VideoDiscoveryDriver } from './types'
import { youtubeDriver } from './drivers/youtube'

const drivers: VideoDiscoveryDriver[] = [youtubeDriver]

export function getVideoDriver(url: string): VideoDiscoveryDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}
