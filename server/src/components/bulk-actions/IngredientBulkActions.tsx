'use client'

import React from 'react'
import { BulkJobMenuItem } from '@/components/BulkJobBar'
import { bulkCrawlIngredients } from '@/actions/job-actions'

export default function IngredientBulkMenuItem() {
  return (
    <BulkJobMenuItem
      label="Crawl Info"
      createJob={bulkCrawlIngredients}
      jobCollection="ingredient-crawls"
    />
  )
}
