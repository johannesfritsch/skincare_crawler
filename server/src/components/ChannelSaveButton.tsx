'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import {
  discoverChannelVideos,
  crawlChannelVideos,
  getJobStatus,
} from '@/actions/job-actions'

export default function ChannelSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const router = useRouter()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <>
          <JobButton
            label="Discover Videos"
            runningLabel="Discovering..."
            createJob={() => discoverChannelVideos(Number(id))}
            getStatus={(jobId) => getJobStatus('video-discoveries', jobId)}
            jobCollection="video-discoveries"
            onCompleted={() => router.refresh()}
          />
          <JobButton
            label="Crawl Videos"
            runningLabel="Crawling..."
            createJob={() => crawlChannelVideos(Number(id))}
            getStatus={(jobId) => getJobStatus('video-crawls', jobId)}
            jobCollection="video-crawls"
            onCompleted={() => router.refresh()}
          />
        </>
      )}
    </div>
  )
}
