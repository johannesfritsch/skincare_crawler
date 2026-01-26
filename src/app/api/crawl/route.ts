import { getAllDrivers, getSupportedHostnames } from '@/lib/crawl-drivers'

export const GET = async () => {
  return Response.json({
    message: 'Crawl API',
    endpoints: {
      discover: {
        url: '/api/crawl/discover',
        method: 'POST',
        description: 'Discover products from a URL. Driver is auto-selected based on hostname.',
        body: { url: 'Required. The category/listing URL to discover products from.' },
      },
      crawl: {
        url: '/api/crawl/crawl',
        method: 'POST',
        description: 'Crawl products. Use with crawlId for session-based crawling, or gtins for direct crawl.',
        body: {
          crawlId: 'Crawl session ID (from discover)',
          itemId: 'Optional. Specific item ID to crawl',
          gtins: 'Array of GTINs for direct crawl',
          driver: 'Driver ID (required with gtins)',
          limit: 'Number of items per batch (default: 10)',
        },
      },
    },
    supportedHostnames: getSupportedHostnames(),
    availableDrivers: getAllDrivers().map((d) => ({
      id: d.id,
      name: d.name,
      hostnames: d.hostnames,
    })),
  })
}
