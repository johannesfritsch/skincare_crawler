'use client'

import { useFormFields } from '@payloadcms/ui'

interface JobOutputFieldProps {
  fieldName: string
  label: string
  description: string
}

export default function JobOutputField({ fieldName, label, description }: JobOutputFieldProps) {
  const value = useFormFields(([fields]) => fields[fieldName]?.value as string | undefined)

  const lines = (value ?? '').trim().split('\n').filter(Boolean)

  return (
    <div style={{ marginBottom: '24px' }}>
      <label
        style={{
          display: 'block',
          marginBottom: '6px',
          fontWeight: 600,
          color: 'var(--theme-text)',
        }}
      >
        {label}
        {lines.length > 0 && (
          <span
            style={{
              fontWeight: 400,
              marginLeft: '8px',
              color: 'var(--theme-elevation-600)',
              fontSize: '13px',
            }}
          >
            ({lines.length} {lines.length === 1 ? 'item' : 'items'})
          </span>
        )}
      </label>
      <p
        style={{
          margin: '0 0 8px 0',
          fontSize: '13px',
          color: 'var(--theme-elevation-600)',
        }}
      >
        {description}
      </p>
      <textarea
        readOnly
        value={value ?? ''}
        rows={Math.min(lines.length || 1, 20)}
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          padding: '8px 12px',
          background: 'var(--theme-elevation-50)',
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 'var(--style-radius-s)',
          color: 'var(--theme-text)',
          resize: 'vertical',
        }}
      />
    </div>
  )
}
