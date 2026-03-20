'use client'

import React from 'react'
import { useField, useFormFields } from '@payloadcms/ui'
import type { RelationshipFieldClientComponent } from 'payload'
import FrameImageWithBox from './FrameImageWithBox'

/**
 * Read-only custom Field component for the `frame` relationship inside
 * video-scenes → objects[] and barcodes[] array rows. Displays the source
 * frame image with a red bounding box overlay (when sibling box fields exist).
 *
 * This bypasses the Payload relationship field caching bug where all
 * array rows show the same relationship value (see payloadcms/payload#15758).
 */
const DetectionFrameField: RelationshipFieldClientComponent = (props) => {
  const { path } = props

  // Read the frame ID from THIS row's scoped path (e.g. "objects.3.frame")
  const { value: frameId } = useField<number>({ path })

  // Read sibling bounding box fields from the same array row (if they exist)
  // path = "objects.3.frame" → rowPrefix = "objects.3."
  const rowPrefix = path.replace(/\.frame$/, '.')
  const boxXMin = useFormFields(([f]) => f[`${rowPrefix}boxXMin`]?.value as number | undefined)
  const boxYMin = useFormFields(([f]) => f[`${rowPrefix}boxYMin`]?.value as number | undefined)
  const boxXMax = useFormFields(([f]) => f[`${rowPrefix}boxXMax`]?.value as number | undefined)
  const boxYMax = useFormFields(([f]) => f[`${rowPrefix}boxYMax`]?.value as number | undefined)

  const box = boxXMin != null && boxYMin != null && boxXMax != null && boxYMax != null
    ? { xMin: boxXMin, yMin: boxYMin, xMax: boxXMax, yMax: boxYMax }
    : null

  return <FrameImageWithBox frameId={frameId ?? null} box={box} />
}

export default DetectionFrameField
