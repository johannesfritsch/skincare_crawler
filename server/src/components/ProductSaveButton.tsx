'use client'

import React from 'react'
import { SaveButton, useDocumentInfo } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import { JobButton } from '@/components/JobButton'
import { aggregateProduct, getJobStatus } from '@/actions/job-actions'

export default function ProductSaveButton(props: SaveButtonClientProps) {
  const { id } = useDocumentInfo()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SaveButton />
      {id && (
        <JobButton
          label="Aggregate"
          runningLabel="Aggregating..."
          createJob={() => aggregateProduct(Number(id))}
          getStatus={(jobId) => getJobStatus('product-aggregations', jobId)}
        />
      )}
    </div>
  )
}
