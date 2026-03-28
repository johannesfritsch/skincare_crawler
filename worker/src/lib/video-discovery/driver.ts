import type { VideoDiscoveryDriver } from './types'
import { youtubeDriver } from './drivers/youtube'
import { instagramDriver } from './drivers/instagram'
import { tiktokDriver } from './drivers/tiktok'

const drivers: VideoDiscoveryDriver[] = [youtubeDriver, instagramDriver, tiktokDriver]

export function getVideoDriver(url: string): VideoDiscoveryDriver | null {
  for (const driver of drivers) {
    if (driver.matches(url)) {
      return driver
    }
  }
  return null
}
