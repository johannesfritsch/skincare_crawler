'use client'

import React, { useState, useEffect } from 'react'

interface Commit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

interface ChangelogData {
  generatedAt: string
  commits: Commit[]
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function commitTypeColor(message: string): string {
  if (message.startsWith('feat')) return '#3b82f6'
  if (message.startsWith('fix')) return '#22c55e'
  if (message.startsWith('refactor')) return '#a855f7'
  if (message.startsWith('test')) return '#eab308'
  if (message.startsWith('docs')) return '#6b7280'
  if (message.startsWith('chore')) return '#6b7280'
  return 'var(--theme-elevation-500)'
}

function commitTypeLabel(message: string): string | null {
  const match = message.match(/^(feat|fix|refactor|test|docs|chore|perf|style|ci|build)(\(.*?\))?[!]?:/)
  return match ? match[1] : null
}

const INITIAL_SHOW = 10

export default function ChangelogClient() {
  const [changelog, setChangelog] = useState<ChangelogData | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetch('/changelog.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setChangelog(data) })
      .catch(() => {})
  }, [])

  if (!changelog || changelog.commits.length === 0) {
    return (
      <div style={{ padding: '16px', color: 'var(--theme-elevation-500)', fontSize: '13px' }}>
        No changelog available.
      </div>
    )
  }

  const commits = showAll ? changelog.commits : changelog.commits.slice(0, INITIAL_SHOW)
  const hasMore = changelog.commits.length > INITIAL_SHOW

  return (
    <div style={{ padding: '16px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)' }}>
          Recent Changes
        </div>
        <div style={{ fontSize: '11px', color: 'var(--theme-elevation-450)' }}>
          {changelog.commits.length} commits
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {commits.map((commit) => {
          const typeLabel = commitTypeLabel(commit.message)
          const typeColor = commitTypeColor(commit.message)
          // Strip conventional commit prefix for cleaner display
          const cleanMessage = commit.message.replace(/^(feat|fix|refactor|test|docs|chore|perf|style|ci|build)(\(.*?\))?[!]?:\s*/, '')

          return (
            <div
              key={commit.hash}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '6px 0',
                borderBottom: '1px solid var(--theme-elevation-100)',
              }}
            >
              {/* Type badge */}
              <div style={{ flexShrink: 0, paddingTop: '1px' }}>
                {typeLabel ? (
                  <span style={{
                    display: 'inline-block',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: typeColor,
                    backgroundColor: `color-mix(in srgb, ${typeColor} 12%, transparent)`,
                    padding: '1px 5px',
                    borderRadius: '3px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.02em',
                    minWidth: '32px',
                    textAlign: 'center',
                  }}>
                    {typeLabel}
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-block',
                    width: '6px', height: '6px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--theme-elevation-300)',
                    marginTop: '4px',
                    marginLeft: '13px',
                  }} />
                )}
              </div>

              {/* Message + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '13px',
                  color: 'var(--theme-text)',
                  lineHeight: 1.35,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {cleanMessage}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--theme-elevation-450)',
                  marginTop: '1px',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{commit.shortHash}</span>
                  {' '}
                  {commit.author}
                  {' '}
                  {timeAgo(commit.date)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {hasMore && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            display: 'block',
            width: '100%',
            marginTop: '8px',
            padding: '6px 0',
            background: 'none',
            border: 'none',
            color: 'var(--theme-elevation-500)',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Show all {changelog.commits.length} commits
        </button>
      )}

      {showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          style={{
            display: 'block',
            width: '100%',
            marginTop: '8px',
            padding: '6px 0',
            background: 'none',
            border: 'none',
            color: 'var(--theme-elevation-500)',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Show less
        </button>
      )}
    </div>
  )
}
