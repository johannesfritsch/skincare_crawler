'use client'

import React from 'react'
import { BulkJobStatusBar } from '@/components/BulkJobBar'

export default function VideoBulkStatus() {
  return <BulkJobStatusBar runningLabel="Processing..." jobCollection="video-processings" />
}
