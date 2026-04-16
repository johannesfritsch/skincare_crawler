'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SaveButton, useDocumentInfo, useConfig, Button } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { startTestSuiteRun } from '@/actions/job-actions'

export default function TestSuiteSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const router = useRouter()
  const [running, setRunning] = useState(false)

  const handleRun = async () => {
    if (!id || running) return
    setRunning(true)
    try {
      const result = await startTestSuiteRun(Number(id))
      if (result.success && result.jobId) {
        router.push(`${config.routes.admin}/collections/test-suite-runs/${result.jobId}`)
      }
    } catch (e) {
      console.error('Failed to start test suite run', e)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <Button
          buttonStyle="secondary"
          size="medium"
          onClick={handleRun}
          disabled={running}
        >
          {running ? 'Starting...' : 'Run'}
        </Button>
      )}
    </div>
  )
}
