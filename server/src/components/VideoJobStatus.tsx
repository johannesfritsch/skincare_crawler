'use client'

import React from 'react'
import { JobStatusBar } from '@/components/BulkJobBar'

export default function VideoJobStatus() {
  return (
    <>
      <JobStatusBar runningLabel="Crawling..." jobCollection="video-crawls" />
      <JobStatusBar runningLabel="Processing..." jobCollection="video-processings" />
    </>
  )
}
