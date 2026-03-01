'use client'

import React from 'react'
import { BulkJobMenuItem } from '@/components/BulkJobBar'
import { bulkProcessVideos } from '@/actions/job-actions'

export default function VideoBulkMenuItem() {
  return (
    <BulkJobMenuItem
      label="Process"
      createJob={bulkProcessVideos}
      jobCollection="video-processings"
    />
  )
}
