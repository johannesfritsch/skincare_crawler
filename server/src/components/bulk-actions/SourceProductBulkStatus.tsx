'use client'

import React from 'react'
import { BulkJobStatusBar } from '@/components/BulkJobBar'

export default function SourceProductBulkStatus() {
  return <BulkJobStatusBar runningLabel="Crawling..." jobCollection="product-crawls" />
}
