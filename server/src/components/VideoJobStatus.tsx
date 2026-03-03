'use client'

import React from 'react'
import { JobStatusBar } from '@/components/BulkJobBar'

export default function VideoJobStatus() {
  return <JobStatusBar runningLabel="Processing..." jobCollection="video-processings" />
}
