'use client'

import React from 'react'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { crawlIngredient, getJobStatus } from '@/actions/job-actions'

export default function IngredientSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <JobButton
          label="Crawl Info"
          runningLabel="Crawling..."
          createJob={() => crawlIngredient(Number(id))}
          getStatus={(jobId) => getJobStatus('ingredient-crawls', jobId)}
        />
      )}
    </div>
  )
}
