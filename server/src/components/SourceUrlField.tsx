'use client'

import React, { useCallback, useState, type ChangeEvent } from 'react'
import { TextInput, FieldLabel, useField, useFormFields } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { ExternalLink, Copy, Check, Pencil } from 'lucide-react'
import { StoreLogo } from './store-logos'
import { detectStoreFromUrl, shortenUrl } from '@/collections/shared/store-fields'

const SourceUrlField: TextFieldClientComponent = (props) => {
  const { field, path } = props
  const { value, setValue } = useField<string>({ path })
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)

  // Try to read a sibling `source` field (exists on source-products)
  const sourceFromForm = useFormFields(([fields]) => fields['source']?.value as string | undefined)

  // Determine the store slug: prefer explicit `source` field, fall back to URL detection
  const storeSlug = sourceFromForm || (value ? detectStoreFromUrl(value) : null)

  const handleCopy = useCallback(async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = value
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [value])

  // No value — just show the text input
  if (!value && !editing) {
    return (
      <div style={{ marginBottom: 'var(--spacing-field)' }}>
        <FieldLabel label={field.label || 'Source URL'} path={path} />
        <TextInput
          path={path}
          value={value ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          label=""
          showError={false}
        />
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 'var(--spacing-field)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <FieldLabel label={field.label || 'Source URL'} path={path} />
      </div>

      {/* Visual display widget */}
      {value && !editing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            background: 'var(--theme-elevation-50)',
            border: '1px solid var(--theme-elevation-150)',
            borderRadius: 'var(--style-radius-s)',
          }}
        >
          {/* Store logo */}
          {storeSlug && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                width: '28px',
                height: '28px',
                background: 'var(--theme-elevation-100)',
                borderRadius: '6px',
                padding: '3px',
              }}
            >
              <StoreLogo source={storeSlug} className="h-4 w-auto" />
            </div>
          )}

          {/* URL — truncated, muted, mono */}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--theme-elevation-500)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.3,
            }}
            title={value}
          >
            {shortenUrl(value)}
          </span>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
            <IconButton href={value} title="Open in new tab">
              <ExternalLink size={14} />
            </IconButton>
            <IconButton onClick={handleCopy} title={copied ? 'Copied!' : 'Copy URL'}>
              {copied ? (
                <Check size={14} style={{ color: 'var(--theme-success-500)' }} />
              ) : (
                <Copy size={14} />
              )}
            </IconButton>
            <IconButton onClick={() => setEditing(true)} title="Edit URL">
              <Pencil size={14} />
            </IconButton>
          </div>
        </div>
      )}

      {/* Text input — shown when editing */}
      {editing && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <TextInput
              path={path}
              value={value ?? ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              label=""
              showError={false}
            />
          </div>
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={{
              marginTop: '4px',
              padding: '6px 10px',
              fontSize: '12px',
              borderRadius: '4px',
              border: '1px solid var(--theme-elevation-300)',
              background: 'var(--theme-elevation-100)',
              color: 'var(--theme-text)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}

export default SourceUrlField

// ── Shared tiny icon button ──

function IconButton({
  href,
  onClick,
  title,
  children,
}: {
  href?: string
  onClick?: () => void
  title: string
  children: React.ReactNode
}) {
  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderRadius: '4px',
    border: 'none',
    background: 'transparent',
    color: 'var(--theme-elevation-500)',
    cursor: 'pointer',
    transition: 'color 0.15s, background 0.15s',
    padding: 0,
    textDecoration: 'none',
  }

  const hover = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = 'var(--theme-text)'
    e.currentTarget.style.background = 'var(--theme-elevation-150)'
  }
  const unhover = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = 'var(--theme-elevation-500)'
    e.currentTarget.style.background = 'transparent'
  }

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={style}
        title={title}
        onMouseEnter={hover}
        onMouseLeave={unhover}
      >
        {children}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      title={title}
      onMouseEnter={hover}
      onMouseLeave={unhover}
    >
      {children}
    </button>
  )
}
