'use client'

import React from 'react'
import { BulkJobBar } from '@/components/BulkJobBar'
import { bulkAggregateProducts } from '@/actions/job-actions'

export default function ProductBulkActions() {
  return (
    <BulkJobBar
      label="Aggregate"
      runningLabel="Aggregating..."
      createJob={bulkAggregateProducts}
      jobCollection="product-aggregations"
    />
  )
}
