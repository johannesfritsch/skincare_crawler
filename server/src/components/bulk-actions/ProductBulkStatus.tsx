'use client'

import React from 'react'
import { BulkJobStatusBar } from '@/components/BulkJobBar'

export default function ProductBulkStatus() {
  return <BulkJobStatusBar runningLabel="Aggregating..." jobCollection="product-aggregations" />
}
