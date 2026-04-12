'use client'

import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState, useCallback } from 'react'

interface JobEvent {
  id: number
  type: string
  name: string | null
  level: string
  message: string
  data: Record<string, unknown> | null
  createdAt: string
}

const PHASE_LABELS: Record<string, string> = {
  searches: 'Searches',
  discoveries: 'Discoveries',
  crawls: 'Crawls',
  aggregations: 'Aggregations',
}

export default function TestSuiteEventsView() {
  const { id } = useDocumentInfo()
  const phasesRaw = useFormFields(([fields]) => fields.phases?.value)
  const statusField = useFormFields(([fields]) => fields.status?.value)
  const [events, setEvents] = useState<Array<{ phase: string; events: JobEvent[] }>>([])
  const [loading, setLoading] = useState(false)

  const fetchEvents = useCallback(async () => {
    if (!phasesRaw || !id) return

    let phases: Record<string, { jobIds: number[]; jobCollection: string }>
    try {
      phases = typeof phasesRaw === 'string' ? JSON.parse(phasesRaw) : phasesRaw as any
    } catch { return }

    setLoading(true)
    const phaseEvents: Array<{ phase: string; events: JobEvent[] }> = []

    for (const [phase, state] of Object.entries(phases)) {
      if (!state.jobIds?.length) continue

      const allEvents: JobEvent[] = []
      for (const jobId of state.jobIds) {
        try {
          const res = await fetch(
            `/api/events?where[job.relationTo][equals]=${state.jobCollection}&where[job.value][equals]=${jobId}&limit=500&sort=createdAt`,
          )
          if (res.ok) {
            const data = await res.json()
            allEvents.push(...(data.docs ?? []))
          }
        } catch { /* ignore */ }
      }

      if (allEvents.length > 0) {
        allEvents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        phaseEvents.push({ phase, events: allEvents })
      }
    }

    setEvents(phaseEvents)
    setLoading(false)
  }, [phasesRaw, id])

  useEffect(() => {
    fetchEvents()
    // Poll while running
    const isRunning = statusField === 'running' || statusField === 'pending'
    if (!isRunning) return
    const interval = setInterval(fetchEvents, 5000)
    return () => clearInterval(interval)
  }, [fetchEvents, statusField])

  if (loading && events.length === 0) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)' }}>Loading events...</div>
  }

  if (events.length === 0) {
    return <div style={{ padding: '12px 0', color: 'var(--theme-elevation-400)' }}>No events yet.</div>
  }

  const typeColor = (type: string) => {
    switch (type) {
      case 'error': return 'var(--theme-error-500)'
      case 'warning': return 'var(--theme-warning-500)'
      case 'success': return 'var(--theme-success-500)'
      default: return 'var(--theme-elevation-500)'
    }
  }

  return (
    <div style={{ fontSize: '13px' }}>
      {events.map(({ phase, events: phaseEvents }) => (
        <div key={phase} style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', color: 'var(--theme-elevation-450)',
            padding: '8px 0 4px', borderBottom: '1px solid var(--theme-elevation-100)',
            marginBottom: '4px',
          }}>
            {PHASE_LABELS[phase] || phase}
          </div>
          {phaseEvents.map((event) => {
            const time = new Date(event.createdAt).toLocaleTimeString()
            const nameShort = event.name?.split('.').pop() || ''
            return (
              <div key={event.id} style={{
                display: 'flex', gap: '8px', alignItems: 'baseline',
                padding: '3px 0', lineHeight: 1.4,
              }}>
                <span style={{ color: 'var(--theme-elevation-400)', flexShrink: 0, fontFamily: 'monospace', fontSize: '11px' }}>
                  {time}
                </span>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: typeColor(event.type), flexShrink: 0, marginTop: '5px',
                }} />
                {nameShort && (
                  <span style={{
                    fontSize: '11px', padding: '0 4px', borderRadius: '3px',
                    background: 'var(--theme-elevation-50)', color: 'var(--theme-elevation-600)',
                    flexShrink: 0,
                  }}>
                    {nameShort}
                  </span>
                )}
                <span style={{ color: 'var(--theme-text)' }}>
                  {event.message}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
