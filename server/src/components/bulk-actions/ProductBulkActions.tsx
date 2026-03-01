'use client'

import React from 'react'
import { BulkJobMenuItem } from '@/components/BulkJobBar'
import { bulkAggregateProducts } from '@/actions/job-actions'

export default function ProductBulkMenuItem() {
  return (
    <BulkJobMenuItem
      label="Aggregate"
      createJob={bulkAggregateProducts}
      jobCollection="product-aggregations"
    />
  )
}
