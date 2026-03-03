'use client'

import React from 'react'
import { JobStatusBar } from '@/components/BulkJobBar'

export default function SourceProductJobStatus() {
  return <JobStatusBar runningLabel="Crawling..." jobCollection="product-crawls" />
}
