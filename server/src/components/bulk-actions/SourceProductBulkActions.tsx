'use client'

import React from 'react'
import { BulkJobMenuItem } from '@/components/BulkJobBar'
import { bulkCrawlSourceProducts } from '@/actions/job-actions'

export default function SourceProductBulkMenuItem() {
  return (
    <BulkJobMenuItem
      label="Crawl"
      createJob={bulkCrawlSourceProducts}
      jobCollection="product-crawls"
    />
  )
}
