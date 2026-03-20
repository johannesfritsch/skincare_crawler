'use client'

import React, { useEffect, useState } from 'react'
import { useField, useDocumentInfo } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import FrameImageWithBox, { type BoundingBox } from './FrameImageWithBox'

/**
 * Read-only custom Field component for the `object` text field inside
 * video-scenes → recognitions[] array rows. Looks up the referenced object
 * in the scene's objects[] array and displays its frame image with bounding box.
 */
const RecognitionObjectField: TextFieldClientComponent = (props) => {
  const { path } = props
  const { value: objectId } = useField<string>({ path })
  const { id: sceneId } = useDocumentInfo()

  const [frameId, setFrameId] = useState<number | null>(null)
  const [box, setBox] = useState<BoundingBox | null>(null)

  // Fetch the scene document to find the matching object entry
  useEffect(() => {
    if (!objectId || !sceneId) {
      setFrameId(null)
      setBox(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/video-scenes/${sceneId}?depth=0`)
        if (!res.ok || cancelled) return
        const scene = await res.json()

        const objects = scene.objects as Array<{
          id: string
          frame?: number
          boxXMin?: number
          boxYMin?: number
          boxXMax?: number
          boxYMax?: number
        }> | null

        const obj = objects?.find((o) => o.id === objectId)
        if (!obj || cancelled) return

        setFrameId(obj.frame ?? null)
        if (obj.boxXMin != null && obj.boxYMin != null && obj.boxXMax != null && obj.boxYMax != null) {
          setBox({ xMin: obj.boxXMin, yMin: obj.boxYMin, xMax: obj.boxXMax, yMax: obj.boxYMax })
        } else {
          setBox(null)
        }
      } catch {
        // silently fail
      }
    })()

    return () => { cancelled = true }
  }, [objectId, sceneId])

  if (!objectId) {
    return (
      <div style={{ marginBottom: 'var(--spacing-field)' }}>
        <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>Detected Object</label>
        <span style={{ color: 'var(--theme-elevation-500)' }}>No object linked</span>
      </div>
    )
  }

  return <FrameImageWithBox frameId={frameId} box={box} label="Detected Object" />
}

export default RecognitionObjectField
