'use client'

import React from 'react'
import { BulkJobBar } from '@/components/BulkJobBar'
import { bulkCrawlSourceProducts } from '@/actions/job-actions'

export default function SourceProductBulkActions() {
  return (
    <BulkJobBar
      label="Crawl"
      runningLabel="Crawling..."
      createJob={bulkCrawlSourceProducts}
      jobCollection="product-crawls"
    />
  )
}
