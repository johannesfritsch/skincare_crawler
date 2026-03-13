'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { crawlVideo, processVideo, getJobStatus } from '@/actions/job-actions'

export default function VideoSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const router = useRouter()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <>
          <JobButton
            label="Crawl"
            runningLabel="Crawling..."
            createJob={() => crawlVideo(Number(id))}
            getStatus={(jobId) => getJobStatus('video-crawls', jobId)}
            jobCollection="video-crawls"
            onCompleted={() => router.refresh()}
          />
          <JobButton
            label="Process"
            runningLabel="Processing..."
            createJob={() => processVideo(Number(id))}
            getStatus={(jobId) => getJobStatus('video-processings', jobId)}
            jobCollection="video-processings"
            onCompleted={() => router.refresh()}
          />
        </>
      )}
    </div>
  )
}
