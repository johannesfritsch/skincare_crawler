'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { startTestSuiteRun, getJobStatus } from '@/actions/job-actions'

export default function TestSuiteSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const router = useRouter()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <JobButton
          label="Run"
          runningLabel="Running..."
          createJob={() => startTestSuiteRun(Number(id))}
          getStatus={(jobId) => getJobStatus('test-suite-runs', jobId)}
          jobCollection="test-suite-runs"
          onCompleted={() => router.refresh()}
        />
      )}
    </div>
  )
}
