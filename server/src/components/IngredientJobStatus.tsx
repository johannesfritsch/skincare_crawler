'use client'

import React from 'react'
import { JobStatusBar } from '@/components/BulkJobBar'

export default function IngredientJobStatus() {
  return <JobStatusBar runningLabel="Crawling info..." jobCollection="ingredient-crawls" />
}
