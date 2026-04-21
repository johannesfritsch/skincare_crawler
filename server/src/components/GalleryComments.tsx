'use client'

import React, { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

interface Comment {
  id?: string | number
  externalId?: string
  username?: string
  text?: string
  createdAt?: string
  likeCount?: number
}

const PAGE_SIZE = 10

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 52) return `${weeks}w`
  return `${Math.floor(weeks / 52)}y`
}

function CommentRow({ comment }: { comment: Comment }) {
  const initial = (comment.username ?? '?')[0].toUpperCase()

  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      padding: '10px 0',
      borderBottom: '1px solid var(--theme-elevation-100)',
    }}>
      {/* Avatar circle */}
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: 'var(--theme-elevation-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--theme-elevation-500)',
        flexShrink: 0,
      }}>
        {initial}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header: username + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--theme-text)',
          }}>
            {comment.username ?? 'unknown'}
          </span>
          {comment.createdAt && (
            <span
              title={new Date(comment.createdAt).toLocaleString()}
              style={{
                fontSize: '12px',
                color: 'var(--theme-elevation-400)',
                cursor: 'default',
              }}
            >
              {timeAgo(comment.createdAt)}
            </span>
          )}
        </div>

        {/* Comment text */}
        <div style={{
          fontSize: '13px',
          lineHeight: '1.45',
          color: 'var(--theme-text)',
          marginTop: '2px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {comment.text}
        </div>

        {/* Likes */}
        {comment.likeCount != null && comment.likeCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginTop: '4px',
            fontSize: '11px',
            color: 'var(--theme-elevation-400)',
            fontWeight: 500,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {comment.likeCount.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}

export default function GalleryComments() {
  const { id } = useDocumentInfo()
  const [comments, setComments] = useState<Comment[]>([])
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [totalDocs, setTotalDocs] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`/api/gallery-comments?where[gallery][equals]=${id}&limit=${PAGE_SIZE}&page=${page + 1}&sort=-createdAt`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.docs)) {
          setComments(data.docs)
          setTotalPages(data.totalPages ?? 0)
          setTotalDocs(data.totalDocs ?? 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id, page])

  if (loading) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '13px' }}>Loading comments...</div>
  }

  if (totalDocs === 0) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)', fontSize: '13px' }}>No comments.</div>
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--theme-elevation-400)' }}>
          {totalDocs} comment{totalDocs !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Comments list */}
      <div>
        {comments.map((c, i) => (
          <CommentRow key={c.id ?? c.externalId ?? `${page}-${i}`} comment={c} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '12px',
        }}>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            style={{
              background: 'none',
              border: '1px solid var(--theme-elevation-200)',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: page === 0 ? 'default' : 'pointer',
              opacity: page === 0 ? 0.4 : 1,
              color: 'var(--theme-text)',
            }}
          >
            Prev
          </button>
          <span style={{ fontSize: '12px', color: 'var(--theme-elevation-400)' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            style={{
              background: 'none',
              border: '1px solid var(--theme-elevation-200)',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: page >= totalPages - 1 ? 'default' : 'pointer',
              opacity: page >= totalPages - 1 ? 0.4 : 1,
              color: 'var(--theme-text)',
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
