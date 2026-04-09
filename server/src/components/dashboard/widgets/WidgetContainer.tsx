'use client'

import React from 'react'

export function WidgetContainer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '16px',
      border: '1px solid var(--theme-elevation-150)',
      backgroundColor: 'var(--theme-elevation-0)',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      {children}
    </div>
  )
}
