'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
import SentimentPyramid from './SentimentPyramid'
import type { SentimentRecord } from './SentimentPyramid'
import SentimentConclusions from './SentimentConclusions'
import type { ConclusionRecord } from './SentimentConclusions'

interface Tab {
  key: string
  label: string
  groupType: 'all' | 'incentivized' | 'organic' | 'individual'
  originId?: number
}

function getOriginId(origin: SentimentRecord['reviewOrigin']): number | null {
  if (!origin) return null
  if (typeof origin === 'number') return origin
  return origin.id ?? null
}

function isIncentivized(origin: SentimentRecord['reviewOrigin']): boolean {
  if (!origin || typeof origin === 'number') return false
  return origin.incentivized === true
}

function getOriginName(origin: SentimentRecord['reviewOrigin']): string {
  if (!origin || typeof origin === 'number') return 'Unknown'
  return origin.name ?? 'Unknown'
}

export default function SentimentOriginTabs() {
  const { id } = useDocumentInfo()
  const [sentiments, setSentiments] = useState<SentimentRecord[]>([])
  const [conclusions, setConclusions] = useState<ConclusionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState('all')

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    async function fetchData() {
      try {
        const [sentRes, concRes] = await Promise.all([
          fetch(`/api/product-sentiments?where[product][equals]=${id}&limit=500&depth=1`),
          fetch(`/api/product-sentiment-conclusions?where[product][equals]=${id}&limit=500&depth=1`),
        ])
        if (sentRes.ok) {
          const json = await sentRes.json()
          setSentiments((json.docs ?? []) as SentimentRecord[])
        }
        if (concRes.ok) {
          const json = await concRes.json()
          setConclusions((json.docs ?? []) as ConclusionRecord[])
        }
      } catch {
        // Silently handle errors
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id])

  // Build tabs from actual data
  const tabs = useMemo<Tab[]>(() => {
    const result: Tab[] = [{ key: 'all', label: 'All', groupType: 'all' }]

    // Check if any sentiment has a non-null reviewOrigin
    const hasOriginData = sentiments.some((s) => getOriginId(s.reviewOrigin) !== null)
    if (!hasOriginData) return result

    result.push(
      { key: 'incentivized', label: 'Incentivized', groupType: 'incentivized' },
      { key: 'organic', label: 'Organic', groupType: 'organic' },
    )

    // Collect individual origins
    const origins = new Map<number, string>()
    for (const s of sentiments) {
      const oid = getOriginId(s.reviewOrigin)
      if (oid !== null && !origins.has(oid)) {
        origins.set(oid, getOriginName(s.reviewOrigin))
      }
    }
    for (const [oid, name] of origins) {
      result.push({ key: `origin-${oid}`, label: name, groupType: 'individual', originId: oid })
    }

    return result
  }, [sentiments])

  // Filter sentiments for selected tab
  const filteredSentiments = useMemo(() => {
    if (selectedTab === 'all') return sentiments
    if (selectedTab === 'incentivized') return sentiments.filter((s) => isIncentivized(s.reviewOrigin))
    if (selectedTab === 'organic') return sentiments.filter((s) => !isIncentivized(s.reviewOrigin))
    // Individual origin
    const tab = tabs.find((t) => t.key === selectedTab)
    if (tab?.originId) return sentiments.filter((s) => getOriginId(s.reviewOrigin) === tab.originId)
    return sentiments
  }, [sentiments, selectedTab, tabs])

  // Filter conclusions for selected tab
  const filteredConclusions = useMemo(() => {
    if (selectedTab === 'all') return conclusions.filter((c) => !c.groupType || c.groupType === 'all')
    if (selectedTab === 'incentivized') return conclusions.filter((c) => c.groupType === 'incentivized')
    if (selectedTab === 'organic') return conclusions.filter((c) => c.groupType === 'organic')
    // Individual origin
    const tab = tabs.find((t) => t.key === selectedTab)
    if (tab?.originId) {
      return conclusions.filter((c) => {
        if (c.groupType !== 'individual') return false
        const cOriginId = typeof c.reviewOrigin === 'object' && c.reviewOrigin ? c.reviewOrigin.id : c.reviewOrigin
        return cOriginId === tab.originId
      })
    }
    return conclusions
  }, [conclusions, selectedTab, tabs])

  if (loading) {
    return (
      <div style={{ padding: '24px 0', color: 'var(--theme-elevation-500)', fontSize: 13 }}>
        Loading sentiments...
      </div>
    )
  }

  if (sentiments.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--theme-elevation-500)', fontSize: 13 }}>
        No sentiment data yet. Run aggregation with Review Sentiment stage enabled.
      </div>
    )
  }

  const emptyMessage = selectedTab === 'all'
    ? 'No sentiment data yet.'
    : `No sentiment data for this origin.`

  return (
    <div>
      {/* Tab bar */}
      {tabs.length > 1 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            marginBottom: 16,
            borderBottom: '1px solid var(--theme-elevation-150)',
            paddingBottom: 8,
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.key === selectedTab
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedTab(tab.key)}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--theme-text)' : 'var(--theme-elevation-500)',
                  backgroundColor: isActive ? 'var(--theme-elevation-100)' : 'transparent',
                  border: isActive ? '1px solid var(--theme-elevation-200)' : '1px solid transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Pyramid */}
      <SentimentPyramid records={filteredSentiments} emptyMessage={emptyMessage} />

      {/* Conclusions */}
      <SentimentConclusions records={filteredConclusions} />
    </div>
  )
}
