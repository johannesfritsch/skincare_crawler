'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, SaveButton, useDocumentInfo, toast } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { rerunJob } from '@/actions/job-actions'

export default function JobSaveButton(_props: SaveButtonClientProps) {
  const { id, collectionSlug } = useDocumentInfo()
  const router = useRouter()
  const [running, setRunning] = useState(false)

  const handleRerun = async () => {
    if (!id || !collectionSlug) return
    setRunning(true)
    try {
      const result = await rerunJob(collectionSlug as any, Number(id))
      if (result.success) {
        toast.success('Job queued for re-run')
        router.refresh()
      } else {
        toast.error(result.error ?? 'Failed to re-run job')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to re-run job')
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
          onClick={handleRerun}
          disabled={running}
        >
          {running ? 'Re-running...' : 'Re-run'}
        </Button>
      )}
    </div>
  )
}
