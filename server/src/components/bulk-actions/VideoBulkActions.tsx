'use client'

import React from 'react'
import { BulkJobMenuItem } from '@/components/BulkJobBar'
import { bulkCrawlVideos, bulkProcessVideos } from '@/actions/job-actions'

export default function VideoBulkMenuItem() {
  return (
    <>
      <BulkJobMenuItem
        label="Crawl"
        createJob={bulkCrawlVideos}
        jobCollection="video-crawls"
      />
      <BulkJobMenuItem
        label="Process"
        createJob={bulkProcessVideos}
        jobCollection="video-processings"
      />
    </>
  )
}
