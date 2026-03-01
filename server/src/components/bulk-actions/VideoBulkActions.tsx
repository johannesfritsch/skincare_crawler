'use client'

import React from 'react'
import { BulkJobBar } from '@/components/BulkJobBar'
import { bulkProcessVideos } from '@/actions/job-actions'

export default function VideoBulkActions() {
  return (
    <BulkJobBar
      label="Process"
      runningLabel="Processing..."
      createJob={bulkProcessVideos}
      jobCollection="video-processings"
    />
  )
}
