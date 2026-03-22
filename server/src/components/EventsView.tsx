'use client'

import type { UIFieldClientComponent } from 'payload'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getAllJobEvents, type FullJobEvent } from '@/actions/job-actions'
import { eventGroup, EVENT_GROUP_LABELS } from '@anyskin/shared'
import { cleanMessage, filterDisplayData, formatTime, formatValue } from './event-display-utils'

/** Strip the event name from the start of a message if it duplicates the badge */
function stripEventName(message: string, name?: string | null): string {
  if (!name || !message) return message
  // Messages often start with the event name or a humanized version of it
  if (message.toLowerCase().startsWith(name.toLowerCase())) {
    const stripped = message.slice(name.length).replace(/^[\s:—–-]+/, '')
    return stripped || message
  }
  // Also try just the action part (after the dot)
  const action = name.includes('.') ? name.split('.').slice(1).join('.') : null
  if (action && message.toLowerCase().startsWith(action.toLowerCase())) {
    const stripped = message.slice(action.length).replace(/^[\s:—–-]+/, '')
    return stripped || message
  }
  return message
}

const POLL_INTERVAL = 3000
const MAX_EVENTS = 5000
const ACTIVE_STATUSES = new Set(['pending', 'in_progress'])

// ─── Types ──────────────────────────────────────────────────────────────────

interface SubGroup {
  key: string
  label: string
  events: FullJobEvent[]
}

interface EventGroupData {
  key: string
  label: string
  subGroups: SubGroup[]
  hasErrors: boolean
  hasWarnings: boolean
  firstTime: string
  lastTime: string
}

// ─── Grouping & filtering ────────────────────────────────────────────────────

function buildGroups(events: FullJobEvent[]): EventGroupData[] {
  // Group by label — all events with the same label merge into one top-level group.
  // stage.started events create sub-groups within their parent group.
  const groupMap = new Map<string, { key: string; label: string; subGroups: SubGroup[] }>()
  const order: string[] = []
  const subGroupCounts = new Map<string, number>()

  for (const event of events) {
    const label = eventGroup(event.name)
    const isStageStart = event.name === 'stage.started'

    // Find or create top-level group for this label
    if (!groupMap.has(label)) {
      groupMap.set(label, { key: label, label, subGroups: [] })
      order.push(label)
    }
    const group = groupMap.get(label)!

    // stage.started creates a named sub-group
    if (isStageStart) {
      const stageName = (event.data?.stage as string) ?? 'Stage'
      const subKey = `${label}/${stageName}`
      const subCount = (subGroupCounts.get(subKey) ?? 0) + 1
      subGroupCounts.set(subKey, subCount)
      group.subGroups.push({ key: `${stageName}#${subCount}`, label: stageName, events: [] })
    }

    // Ensure there's always a sub-group to append to
    if (group.subGroups.length === 0) {
      group.subGroups.push({ key: `${label}/default`, label: '', events: [] })
    }

    group.subGroups[group.subGroups.length - 1].events.push(event)
  }

  // Reverse: newest groups first
  return order.reverse().map((label) => {
    const g = groupMap.get(label)!
    const allEvents = g.subGroups.flatMap((s: SubGroup) => s.events)
    return {
      key: g.key,
      label: g.label,
      subGroups: g.subGroups.reverse().map((s: SubGroup) => ({
        ...s,
        events: s.events.reverse(),
      })),
      hasErrors: allEvents.some((e: FullJobEvent) => e.type === 'error'),
      hasWarnings: allEvents.some((e: FullJobEvent) => e.type === 'warning'),
      firstTime: allEvents[0]?.createdAt ?? '',
      lastTime: allEvents[allEvents.length - 1]?.createdAt ?? '',
    }
  })
}

/** Get all events from a group (top-level + sub-groups) */
function allGroupEvents(g: EventGroupData): FullJobEvent[] {
  return g.subGroups.flatMap((s) => s.events)
}

function filterEvents(events: FullJobEvent[], typeFilter: string | null, searchText: string): FullJobEvent[] {
  let filtered = events
  if (typeFilter) {
    filtered = filtered.filter((e: FullJobEvent) => e.type === typeFilter)
  }
  if (searchText) {
    const lower = searchText.toLowerCase()
    filtered = filtered.filter(
      (e: FullJobEvent) =>
        (e.name?.toLowerCase().includes(lower)) ||
        e.message.toLowerCase().includes(lower),
    )
  }
  return filtered
}

function applyFilters(
  groups: EventGroupData[],
  typeFilter: string | null,
  searchText: string,
): EventGroupData[] {
  if (!typeFilter && !searchText) return groups

  return groups
    .map((g) => {
      const filteredSubs = g.subGroups
        .map((s) => ({ ...s, events: filterEvents(s.events, typeFilter, searchText) }))
        .filter((s) => s.events.length > 0)
      const allFiltered = filteredSubs.flatMap((s) => s.events)
      return {
        ...g,
        subGroups: filteredSubs,
        hasErrors: allFiltered.some((e: FullJobEvent) => e.type === 'error'),
        hasWarnings: allFiltered.some((e: FullJobEvent) => e.type === 'warning'),
      }
    })
    .filter((g) => g.subGroups.length > 0)
}

function countByType(events: FullJobEvent[]): Record<string, number> {
  const counts: Record<string, number> = { total: events.length }
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1
  }
  return counts
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const emptyStyle: React.CSSProperties = {
  padding: '20px',
  textAlign: 'center',
  color: 'var(--theme-elevation-500)',
  fontSize: '13px',
}

// ─── FilterBar ───────────────────────────────────────────────────────────────

function FilterBar({
  typeFilter,
  setTypeFilter,
  searchText,
  setSearchText,
  counts,
}: {
  typeFilter: string | null
  setTypeFilter: (v: string | null) => void
  searchText: string
  setSearchText: (v: string) => void
  counts: Record<string, number>
}) {
  const types = [
    { value: null, label: 'All', count: counts.total ?? 0 },
    { value: 'error', label: 'Errors', count: counts.error ?? 0 },
    { value: 'warning', label: 'Warnings', count: counts.warning ?? 0 },
    { value: 'success', label: 'Success', count: counts.success ?? 0 },
    { value: 'info', label: 'Info', count: counts.info ?? 0 },
  ].filter((t) => t.count > 0 || t.value === null)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {types.map((t) => (
          <button
            key={t.value ?? 'all'}
            type="button"
            onClick={() => setTypeFilter(t.value)}
            style={{
              padding: '3px 10px',
              fontSize: '12px',
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: '12px',
              background:
                typeFilter === t.value
                  ? 'var(--theme-elevation-200)'
                  : 'var(--theme-elevation-50)',
              color: 'var(--theme-text)',
              cursor: 'pointer',
            }}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Search events..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{
          flex: 1,
          minWidth: '150px',
          padding: '8px 12px',
          fontSize: '13px',
          border: '1px solid var(--theme-elevation-150)',
          borderRadius: 'var(--style-radius-s)',
          background: 'var(--theme-elevation-0)',
          color: 'var(--theme-text)',
          outline: 'none',
        }}
      />
    </div>
  )
}

// ─── TruncatedBanner ─────────────────────────────────────────────────────────

function TruncatedBanner() {
  return (
    <div
      style={{
        background: 'var(--theme-warning-100)',
        border: '1px solid var(--theme-warning-500)',
        borderRadius: 'var(--style-radius-s)',
        padding: '8px 12px',
        fontSize: '12px',
        color: 'var(--theme-warning-500)',
        marginBottom: '12px',
      }}
    >
      Showing latest {MAX_EVENTS.toLocaleString()} events. Older events are not displayed.
    </div>
  )
}

// ─── EventItem ───────────────────────────────────────────────────────────────

function EventItem({ event }: { event: FullJobEvent }) {
  const [dataExpanded, setDataExpanded] = useState(false)

  const typeColors: Record<string, string> = {
    error: 'var(--theme-error-500)',
    warning: 'var(--theme-warning-500)',
    success: 'var(--theme-success-500)',
    start: 'var(--theme-elevation-500)',
    info: 'var(--theme-elevation-400)',
  }
  const dotColor = typeColors[event.type] ?? 'var(--theme-elevation-400)'

  const displayData = event.data ? filterDisplayData(event.data) : []
  const hasData = displayData.length > 0

  return (
    <div style={{ fontSize: '12px', padding: '4px 0' }}>
      <div
        onClick={hasData ? () => setDataExpanded(!dataExpanded) : undefined}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          cursor: hasData ? 'pointer' : 'default',
          borderRadius: '3px',
          padding: '2px 4px',
          margin: '0 -4px',
        }}
      >
        {/* Severity dot */}
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
            marginTop: '5px',
          }}
        />

        {/* Timestamp */}
        <span
          style={{
            color: 'var(--theme-elevation-400)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
          }}
        >
          {formatTime(event.createdAt)}
        </span>

        {/* Event action badge (just the part after the dot) */}
        {event.name && (
          <span
            style={{
              background: 'var(--theme-elevation-100)',
              padding: '1px 6px',
              borderRadius: '3px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--theme-elevation-600)',
              flexShrink: 0,
            }}
          >
            {event.name.includes('.') ? event.name.split('.').slice(1).join('.') : event.name}
          </span>
        )}

        {/* Message (strip event name prefix if it duplicates the badge) */}
        <span style={{ color: 'var(--theme-text)', flex: 1 }}>
          {stripEventName(cleanMessage(event.message), event.name)}
        </span>

        {/* Data count indicator */}
        {hasData && (
          <span style={{ color: 'var(--theme-elevation-400)', fontSize: '11px', flexShrink: 0 }}>
            {dataExpanded ? '−' : `+${displayData.length}`}
          </span>
        )}
      </div>

      {/* Expanded data */}
      {dataExpanded && hasData && (
        <div
          style={{
            marginTop: '4px',
            paddingLeft: '22px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
          }}
        >
          {displayData.map(([key, value]) => (
            <span
              key={key}
              style={{
                background: 'var(--theme-elevation-50)',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: '3px',
                padding: '1px 6px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--theme-elevation-500)',
              }}
            >
              {key}: {formatValue(key, value)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── GroupSection ────────────────────────────────────────────────────────────

function severityColor(hasErrors: boolean, hasWarnings: boolean): string {
  if (hasErrors) return 'var(--theme-error-500)'
  if (hasWarnings) return 'var(--theme-warning-500)'
  return 'var(--theme-success-500)'
}

function SubGroupSection({ sub }: { sub: SubGroup }) {
  const hasErrors = sub.events.some((e) => e.type === 'error')
  const hasWarnings = sub.events.some((e) => e.type === 'warning')
  const defaultExpanded = hasErrors || hasWarnings
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div style={{ marginBottom: '2px' }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '4px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--theme-text)',
          fontSize: '12px',
          textAlign: 'left',
        }}
      >
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: severityColor(hasErrors, hasWarnings), flexShrink: 0 }} />
        <span style={{ fontWeight: 500 }}>{sub.label}</span>
        <span style={{ color: 'var(--theme-elevation-500)', fontSize: '11px' }}>
          {sub.events.length}
          {hasErrors && ` · ${sub.events.filter((e) => e.type === 'error').length} err`}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--theme-elevation-400)' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: '12px' }}>
          {sub.events.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupSection({ group }: { group: EventGroupData }) {
  const defaultExpanded =
    group.hasErrors || group.hasWarnings || group.label === 'Job Lifecycle'
  const [expanded, setExpanded] = useState(defaultExpanded)

  const events = allGroupEvents(group)
  const eventCount = events.length

  const timeSpan =
    eventCount > 1
      ? `${formatTime(group.firstTime)} – ${formatTime(group.lastTime)}`
      : formatTime(group.firstTime)

  return (
    <div style={{ borderBottom: '1px solid var(--theme-elevation-150)' }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '8px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--theme-text)',
          fontSize: '13px',
          textAlign: 'left',
        }}
      >
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: severityColor(group.hasErrors, group.hasWarnings), flexShrink: 0 }} />
        <span style={{ fontWeight: 600 }}>{group.label}</span>
        <span style={{ color: 'var(--theme-elevation-500)', fontSize: '12px' }}>
          {eventCount}
          {group.hasErrors && ` · ${events.filter((e) => e.type === 'error').length} errors`}
          {group.hasWarnings && !group.hasErrors && ` · ${events.filter((e) => e.type === 'warning').length} warnings`}
        </span>
        <span style={{ color: 'var(--theme-elevation-400)', fontSize: '11px', marginLeft: 'auto' }}>
          {timeSpan}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--theme-elevation-400)' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {expanded && (
        <div style={{ paddingLeft: '16px', paddingBottom: '8px' }}>
          {group.subGroups.map((sub) =>
            sub.events.length === 1 && !sub.label ? (
              <EventItem key={sub.events[0].id} event={sub.events[0]} />
            ) : sub.label ? (
              <SubGroupSection key={sub.key} sub={sub} />
            ) : (
              sub.events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ─── EventsView ──────────────────────────────────────────────────────────────

const EventsView: UIFieldClientComponent = () => {
  const { id, collectionSlug } = useDocumentInfo()
  const status = useFormFields(([fields]) => fields.status?.value as string | undefined)

  const [events, setEvents] = useState<FullJobEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const lastDateRef = useRef<string | null>(null)

  const fetchEvents = useCallback(
    async (incremental: boolean) => {
      if (!id || !collectionSlug) return
      const { events: newEvents, truncated: t } = await getAllJobEvents(
        collectionSlug as Parameters<typeof getAllJobEvents>[0],
        Number(id),
        incremental ? lastDateRef.current : undefined,
      )
      if (incremental && newEvents.length > 0) {
        setEvents((prev) => [...prev, ...newEvents])
      } else if (!incremental) {
        setEvents(newEvents)
        setTruncated(t)
      }
      if (newEvents.length > 0) {
        lastDateRef.current = newEvents[newEvents.length - 1].createdAt
      }
      setLoading(false)
    },
    [id, collectionSlug],
  )

  // Initial fetch
  useEffect(() => {
    fetchEvents(false)
  }, [fetchEvents])

  // Polling when active
  useEffect(() => {
    if (!status || !ACTIVE_STATUSES.has(status)) return
    const interval = setInterval(() => fetchEvents(true), POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchEvents, status])

  if (!id || !collectionSlug) {
    return <div style={emptyStyle}>Save the document to see events.</div>
  }
  if (loading) {
    return <div style={emptyStyle}>Loading events...</div>
  }
  if (events.length === 0) {
    return <div style={emptyStyle}>No events yet.</div>
  }

  const groups = buildGroups(events)
  const filtered = applyFilters(groups, typeFilter, searchText)
  const counts = countByType(events)

  return (
    <div>
      <FilterBar
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        searchText={searchText}
        setSearchText={setSearchText}
        counts={counts}
      />
      {truncated && <TruncatedBanner />}
      {filtered.map((g) => (
        <GroupSection key={g.key} group={g} />
      ))}
    </div>
  )
}

export default EventsView
