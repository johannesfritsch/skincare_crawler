'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { processVideo, getJobStatus } from '@/actions/job-actions'

export default function VideoSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const router = useRouter()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <JobButton
          label="Process"
          runningLabel="Processing..."
          createJob={() => processVideo(Number(id))}
          getStatus={(jobId) => getJobStatus('video-processings', jobId)}
          onCompleted={() => router.refresh()}
        />
      )}
    </div>
  )
}
