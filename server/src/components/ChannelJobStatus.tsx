'use client'

import React from 'react'
import { JobStatusBar } from '@/components/BulkJobBar'

export default function ChannelJobStatus() {
  return (
    <>
      <JobStatusBar runningLabel="Discovering videos..." jobCollection="video-discoveries" />
      <JobStatusBar runningLabel="Crawling videos..." jobCollection="video-crawls" />
    </>
  )
}
