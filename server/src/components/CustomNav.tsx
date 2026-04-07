'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNav, useConfig, Link, Hamburger } from '@payloadcms/ui'
import { usePathname } from 'next/navigation.js'

// ─── Job types ───

interface JobTypeDef {
  label: string
  slug: string
}

const JOB_TYPES: JobTypeDef[] = [
  { label: 'Product Crawl', slug: 'product-crawls' },
  { label: 'Product Discovery', slug: 'product-discoveries' },
  { label: 'Product Search', slug: 'product-searches' },
  { label: 'Product Aggregation', slug: 'product-aggregations' },
  { label: 'Video Discovery', slug: 'video-discoveries' },
  { label: 'Video Crawl', slug: 'video-crawls' },
  { label: 'Video Processing', slug: 'video-processings' },
  { label: 'Ingredients Discovery', slug: 'ingredients-discoveries' },
  { label: 'Ingredient Crawl', slug: 'ingredient-crawls' },
]

// ─── Tab definitions ───

interface NavSection {
  label?: string // omit for ungrouped items at top
  collections: string[]
  globals?: string[]
}

interface NavTab {
  id: string
  label: string
  sections: NavSection[]
}

const TABS: NavTab[] = [
  {
    id: 'products',
    label: 'Products',
    sections: [
      {
        label: 'Products',
        collections: ['products', 'product-variants', 'brands', 'product-types'],
      },
      {
        label: 'Sources',
        collections: ['source-products', 'source-variants', 'source-brands', 'source-reviews', 'source-review-origins'],
      },
      {
        label: 'Ingredients',
        collections: ['ingredients'],
      },
      {
        label: 'Sentiment',
        collections: ['product-sentiments', 'product-sentiment-conclusions'],
      },
    ],
  },
  {
    id: 'videos',
    label: 'Videos',
    sections: [
      {
        label: 'Videos',
        collections: ['videos', 'creators', 'channels'],
      },
      {
        label: 'Data',
        collections: ['video-scenes', 'video-frames', 'video-mentions'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    sections: [
      {
        label: 'System',
        collections: ['users', 'workers', 'events'],
        globals: ['crawler-settings'],
      },
      {
        label: 'Media',
        collections: ['product-media', 'video-media', 'profile-media', 'brand-media', 'detection-media', 'ingredient-media'],
      },
      {
        label: 'Other',
        collections: ['debug-screenshots'],
      },
    ],
  },
]

// ─── Collection labels ───

const COLLECTION_LABELS: Record<string, string> = {
  'products': 'Products',
  'product-variants': 'Product Variants',
  'brands': 'Brands',
  'product-types': 'Product Types',
  'ingredients': 'Ingredients',
  'source-products': 'Source Products',
  'source-brands': 'Source Brands',
  'source-variants': 'Source Variants',
  'source-reviews': 'Source Reviews',
  'source-review-origins': 'Review Origins',
  'product-sentiments': 'Sentiments',
  'product-sentiment-conclusions': 'Sentiment Conclusions',
  'creators': 'Creators',
  'channels': 'Channels',
  'videos': 'Videos',
  'video-scenes': 'Video Scenes',
  'video-frames': 'Video Frames',
  'video-mentions': 'Video Mentions',
  'users': 'Users',
  'workers': 'Workers',
  'events': 'Events',
  'debug-screenshots': 'Debug Screenshots',
  'product-media': 'Product Media',
  'video-media': 'Video Media',
  'profile-media': 'Profile Media',
  'brand-media': 'Brand Media',
  'detection-media': 'Detection Media',
  'ingredient-media': 'Ingredient Media',
}

const GLOBAL_LABELS: Record<string, string> = {
  'crawler-settings': 'Crawler Settings',
}

// ─── Job status ───

interface JobQueueEntry {
  collection: string
  pending: number
  inProgress: number
  completed: number
  failed: number
}

function getJobDotColor(entry: JobQueueEntry | undefined): string {
  if (!entry) return 'var(--theme-elevation-400)'
  if (entry.inProgress > 0) return 'var(--theme-success-500)'
  if (entry.failed > 0) return 'var(--theme-error-500)'
  if (entry.pending > 0) return 'var(--theme-elevation-600)'
  return 'var(--theme-elevation-400)'
}

function getJobDotTitle(entry: JobQueueEntry | undefined): string {
  if (!entry) return 'No data'
  if (entry.inProgress > 0) return `${entry.inProgress} running`
  if (entry.failed > 0) return `${entry.failed} failed`
  if (entry.pending > 0) return `${entry.pending} pending`
  return 'Idle'
}

// ─── Component ───

export function CustomNav() {
  const { hydrated, navOpen, navRef, setNavOpen, shouldAnimate } = useNav()
  const { config } = useConfig()
  const pathname = usePathname()
  const adminRoute = config.routes.admin

  const [activeTab, setActiveTab] = useState('products')
  const [jobsOpen, setJobsOpen] = useState(false)
  const [jobQueue, setJobQueue] = useState<JobQueueEntry[]>([])
  const jobsRef = useRef<HTMLDivElement>(null)

  // Auto-select tab based on current path
  useEffect(() => {
    for (const tab of TABS) {
      for (const section of tab.sections) {
        for (const slug of section.collections) {
          if (pathname.startsWith(`${adminRoute}/collections/${slug}`)) {
            setActiveTab(tab.id)
            return
          }
        }
        for (const slug of section.globals ?? []) {
          if (pathname.startsWith(`${adminRoute}/globals/${slug}`)) {
            setActiveTab(tab.id)
            return
          }
        }
      }
    }
  }, [pathname, adminRoute])

  const fetchJobStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/snapshot')
      if (res.ok) {
        const data = await res.json()
        if (data.jobQueue) setJobQueue(data.jobQueue)
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => {
    if (jobsOpen) fetchJobStatus()
  }, [jobsOpen, fetchJobStatus])

  useEffect(() => {
    if (!jobsOpen) return
    const onClick = (e: MouseEvent) => {
      if (jobsRef.current && !jobsRef.current.contains(e.target as Node)) setJobsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setJobsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [jobsOpen])

  // Always render the aside shell so the CSS grid layout has its nav column.
  // Before hydration, render an empty nav to prevent layout shift.
  if (!hydrated) {
    return (
      <aside className="nav">
        <div className="nav__scroll" ref={navRef}>
          <nav className="nav__wrap" />
        </div>
      </aside>
    )
  }

  const hasRunning = jobQueue.some(e => e.inProgress > 0)
  const hasFailed = jobQueue.some(e => e.failed > 0 && e.inProgress === 0)
  const btnDotColor = hasRunning ? 'var(--theme-success-500)' : hasFailed ? 'var(--theme-error-500)' : 'var(--theme-elevation-400)'
  const currentTab = TABS.find(t => t.id === activeTab) ?? TABS[0]

  const asideClasses = [
    'nav',
    navOpen && 'nav--nav-open',
    shouldAnimate && 'nav--nav-animate',
    hydrated && 'nav--nav-hydrated',
  ].filter(Boolean).join(' ')

  // Render a collection link matching Payload's default nav__link pattern
  const renderLink = (slug: string, href: string, label: string, idPrefix = 'nav') => {
    const isActive = pathname.startsWith(href) && ["/", undefined].includes(pathname[href.length])
    if (pathname === href) {
      return (
        <div key={slug} className="nav__link" id={`${idPrefix}-${slug}`} style={{ position: 'relative' }}>
          {isActive && <div className="nav__link-indicator" />}
          <span className="nav__link-label">{label}</span>
        </div>
      )
    }
    return (
      <Link key={slug} href={href} className="nav__link" id={`${idPrefix}-${slug}`}
        prefetch={false} style={{ textDecoration: 'none', position: 'relative' }}>
        {isActive && <div className="nav__link-indicator" />}
        <span className="nav__link-label">{label}</span>
      </Link>
    )
  }

  return (
    <aside className={asideClasses} inert={!navOpen ? true : undefined}>
      <style>{`
        .cnav-jobs-btn {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 9px 12px;
          background: var(--theme-elevation-50);
          border: 1px solid var(--theme-elevation-200);
          border-radius: 6px; color: var(--theme-text);
          cursor: pointer; font-size: var(--theme-baseline-body-size);
          font-weight: 600; font-family: inherit; text-align: left;
          transition: background 0.1s, border-color 0.1s;
        }
        .cnav-jobs-btn:hover, .cnav-jobs-btn--open {
          background: var(--theme-elevation-150);
          border-color: var(--theme-elevation-300);
        }
        .cnav-job-link {
          flex: 1; display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: 4px;
          color: var(--theme-text); text-decoration: none;
          font-size: var(--theme-baseline-body-size);
          line-height: 1.35; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
          transition: background 0.1s;
        }
        .cnav-job-link:hover { background: var(--theme-elevation-50); }
        .cnav-job-link--active, .cnav-job-link--active:hover {
          background: var(--theme-elevation-100);
        }
        .cnav-job-create {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 26px; border-radius: 4px;
          color: var(--theme-elevation-450); text-decoration: none;
          font-size: 16px; line-height: 1; flex-shrink: 0;
          transition: background 0.1s, color 0.1s;
        }
        .cnav-job-create:hover {
          background: var(--theme-elevation-100);
          color: var(--theme-text);
        }
        .cnav-header-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 6px;
          color: var(--theme-elevation-500);
          text-decoration: none;
          transition: background 0.1s, color 0.1s;
        }
        .cnav-header-btn:hover {
          background: var(--theme-elevation-100);
          color: var(--theme-text);
        }
      `}</style>
      <div className="nav__scroll" ref={navRef}>
        <nav className="nav__wrap">

          {/* ── Jobs Button ── */}
          <div ref={jobsRef} style={{
            position: 'relative',
            width: 'calc(100% + var(--base) * 2)',
            marginLeft: 'calc(-1 * var(--base))',
            marginBottom: '10px',
            padding: '0 var(--base)',
            boxSizing: 'border-box',
          }}>
            <button
              type="button"
              onClick={() => setJobsOpen(!jobsOpen)}
              className={`cnav-jobs-btn ${jobsOpen ? 'cnav-jobs-btn--open' : ''}`}
            >
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                backgroundColor: btnDotColor, flexShrink: 0,
              }} />
              <span style={{ flex: 1 }}>Jobs</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                style={{
                  transform: jobsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s', flexShrink: 0, opacity: 0.5,
                }}>
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Jobs dropdown — aligned with the button */}
            {jobsOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 'var(--base)', right: 'var(--base)',
                zIndex: 100,
                backgroundColor: 'var(--theme-elevation-0)',
                border: '1px solid var(--theme-elevation-200)',
                borderRadius: '6px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                padding: '4px',
                maxHeight: '55vh',
                overflowY: 'auto',
              }}>
                {JOB_TYPES.map((job) => {
                  const entry = jobQueue.find(e => e.collection === job.slug)
                  const dotColor = getJobDotColor(entry)
                  const dotTitle = getJobDotTitle(entry)
                  const isActive = pathname.startsWith(`${adminRoute}/collections/${job.slug}`)

                  return (
                    <div key={job.slug} className="cnav-job-row" style={{
                      display: 'flex', alignItems: 'center',
                    }}>
                      <Link
                        href={`${adminRoute}/collections/${job.slug}`}
                        onClick={() => setJobsOpen(false)}
                        prefetch={false}
                        className={`cnav-job-link ${isActive ? 'cnav-job-link--active' : ''}`}
                      >
                        <span title={dotTitle} style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          backgroundColor: dotColor, flexShrink: 0,
                        }} />
                        <span>{job.label}</span>
                      </Link>
                      <Link
                        href={`${adminRoute}/collections/${job.slug}/create`}
                        onClick={() => setJobsOpen(false)}
                        prefetch={false}
                        title={`New ${job.label}`}
                        className="cnav-job-create"
                      >
                        +
                      </Link>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Tabs ── */}
          <div style={{
            display: 'flex',
            gap: '4px',
            width: 'calc(100% + var(--base) * 2)',
            marginLeft: 'calc(-1 * var(--base))',
            padding: '0 var(--base)',
            borderBottom: '1px solid var(--theme-elevation-150)',
            marginBottom: '6px',
            boxSizing: 'border-box',
          }}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1,
                    padding: '7px 4px 8px',
                    background: 'none', border: 'none',
                    borderBottom: isActive ? '2px solid var(--theme-text)' : '2px solid transparent',
                    marginBottom: '-1px',
                    cursor: 'pointer',
                    fontSize: 'var(--theme-baseline-body-size)',
                    fontWeight: isActive ? 600 : 400,
                    fontFamily: 'inherit',
                    color: isActive ? 'var(--theme-text)' : 'var(--theme-elevation-450)',
                    transition: 'color 0.1s',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* ── Collection Links (grouped by section) ── */}
          <div style={{ width: '100%' }}>
          {currentTab.sections.map((section, si) => (
            <div key={si}>
              {section.label && (
                <div style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--theme-elevation-450)',
                  padding: '10px 0 4px',
                  marginTop: si > 0 ? '4px' : '0',
                }}>
                  {section.label}
                </div>
              )}
              {section.collections.map((slug) => {
                const href = `${adminRoute}/collections/${slug}`
                const label = COLLECTION_LABELS[slug] || slug
                return renderLink(slug, href, label)
              })}
              {section.globals?.map((slug) => {
                const href = `${adminRoute}/globals/${slug}`
                const label = GLOBAL_LABELS[slug] || slug
                return renderLink(slug, href, label, 'nav-global')
              })}
            </div>
          ))}
          </div>

          {/* ── Controls ── */}
          <div className="nav__controls" />

        </nav>
        <div className="nav__header" style={{ width: 'var(--nav-width)', boxSizing: 'border-box' }}>
          <div className="nav__header-content" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '100%',
            padding: '0 var(--gutter-h)',
          }}>
            {/* Left: mobile close */}
            <button
              className="nav__mobile-close"
              onClick={() => setNavOpen(false)}
              tabIndex={navOpen ? undefined : -1}
              type="button"
            >
              <Hamburger isActive={true} />
            </button>

            {/* Right: action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
              {/* Dashboard */}
              <Link
                href={`${adminRoute}/`}
                prefetch={false}
                className="cnav-header-btn"
                title="Dashboard"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </Link>

              {/* Changelog */}
              <Link
                href={`${adminRoute}/globals/changelog`}
                prefetch={false}
                className="cnav-header-btn"
                title="Changelog"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v4l3 3" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </Link>

              {/* Logout */}
              <Link
                href={`${adminRoute}/logout`}
                prefetch={false}
                className="cnav-header-btn"
                title="Logout"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
