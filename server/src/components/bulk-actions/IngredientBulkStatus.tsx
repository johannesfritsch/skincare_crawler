'use client'

import React from 'react'
import { BulkJobStatusBar } from '@/components/BulkJobBar'

export default function IngredientBulkStatus() {
  return <BulkJobStatusBar runningLabel="Crawling..." jobCollection="ingredient-crawls" />
}
