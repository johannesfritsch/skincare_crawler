'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { crawlSourceProduct, getJobStatus } from '@/actions/job-actions'

export default function SourceProductSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const router = useRouter()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <JobButton
          label="Crawl"
          runningLabel="Crawling..."
          createJob={() => crawlSourceProduct(Number(id))}
          getStatus={(jobId) => getJobStatus('product-crawls', jobId)}
          onCompleted={() => router.refresh()}
        />
      )}
    </div>
  )
}
