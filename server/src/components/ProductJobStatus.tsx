'use client'

import React from 'react'
import { JobStatusBar } from '@/components/BulkJobBar'

export default function ProductJobStatus() {
  return <JobStatusBar runningLabel="Aggregating..." jobCollection="product-aggregations" />
}
