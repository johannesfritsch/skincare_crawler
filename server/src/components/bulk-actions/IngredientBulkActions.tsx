'use client'

import React from 'react'
import { BulkJobBar } from '@/components/BulkJobBar'
import { bulkCrawlIngredients } from '@/actions/job-actions'

export default function IngredientBulkActions() {
  return (
    <BulkJobBar
      label="Crawl Info"
      runningLabel="Crawling..."
      createJob={bulkCrawlIngredients}
      jobCollection="ingredient-crawls"
    />
  )
}
