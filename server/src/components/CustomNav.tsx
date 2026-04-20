'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNav, useConfig, Link, Hamburger } from '@payloadcms/ui'
import { usePathname } from 'next/navigation.js'

// ─── Section definitions with inline jobs ───

interface JobDef {
  label: string
  slug: string
}

interface NavSection {
  label?: string
  collections: string[]
  globals?: string[]
  jobs?: JobDef[]
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
        collections: ['products', 'product-variants', 'brands', 'product-types', 'product-sentiments', 'product-sentiment-conclusions'],
        jobs: [
          { label: 'Aggregate', slug: 'product-aggregations' },
        ],
      },
      {
        label: 'Sources',
        collections: ['source-products', 'source-variants', 'source-brands', 'source-reviews', 'source-review-origins'],
        jobs: [
          { label: 'Crawl', slug: 'product-crawls' },
          { label: 'Discovery', slug: 'product-discoveries' },
          { label: 'Search', slug: 'product-searches' },
        ],
      },
      {
        label: 'Ingredients',
        collections: ['ingredients'],
        jobs: [
          { label: 'Discovery', slug: 'ingredients-discoveries' },
          { label: 'Crawl', slug: 'ingredient-crawls' },
        ],
      },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    sections: [
      {
        label: 'Social Media',
        collections: ['creators', 'channels'],
      },
      {
        label: 'Videos',
        collections: ['videos', 'video-scenes', 'video-frames', 'video-mentions'],
        jobs: [
          { label: 'Discovery', slug: 'video-discoveries' },
          { label: 'Crawl', slug: 'video-crawls' },
          { label: 'Processing', slug: 'video-processings' },
        ],
      },
      {
        label: 'Galleries',
        collections: ['galleries', 'gallery-items', 'gallery-mentions'],
        jobs: [
          { label: 'Discovery', slug: 'gallery-discoveries' },
          { label: 'Crawl', slug: 'gallery-crawls' },
          { label: 'Processing', slug: 'gallery-processings' },
        ],
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
        collections: ['product-media', 'video-media', 'gallery-media', 'profile-media', 'brand-media', 'detection-media', 'ingredient-media'],
      },
      {
        label: 'Debug',
        collections: ['bot-checks', 'debug-screenshots', 'test-suites'],
        jobs: [
          { label: 'Bot Check', slug: 'bot-checks' },
          { label: 'Test Runs', slug: 'test-suite-runs' },
        ],
      },
    ],
  },
]

// ─── Collection & global labels ───

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
  'galleries': 'Galleries',
  'gallery-items': 'Gallery Items',
  'gallery-mentions': 'Gallery Mentions',
  'users': 'Users',
  'workers': 'Workers',
  'events': 'Events',
  'bot-checks': 'Bot Checks',
  'test-suites': 'Test Suites',
  'test-suite-runs': 'Test Suite Runs',
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

function jobDotColor(entry: JobQueueEntry | undefined): string {
  if (!entry) return 'var(--theme-elevation-300)'
  if (entry.inProgress > 0) return 'var(--theme-success-500)'
  if (entry.failed > 0) return 'var(--theme-error-500)'
  if (entry.pending > 0) return 'var(--theme-elevation-600)'
  return 'var(--theme-elevation-300)'
}

function jobTitle(entry: JobQueueEntry | undefined): string {
  if (!entry) return 'Idle'
  if (entry.inProgress > 0) return `${entry.inProgress} running`
  if (entry.failed > 0) return `${entry.failed} failed`
  if (entry.pending > 0) return `${entry.pending} pending`
  return 'Idle'
}

/** Aggregate dot color: worst status across a set of jobs */
function aggregateDotColor(jobs: JobDef[], jobQueue: JobQueueEntry[]): string {
  let hasRunning = false
  let hasFailed = false
  let hasPending = false
  for (const job of jobs) {
    const entry = jobQueue.find(e => e.collection === job.slug)
    if (entry?.inProgress && entry.inProgress > 0) hasRunning = true
    if (entry?.failed && entry.failed > 0) hasFailed = true
    if (entry?.pending && entry.pending > 0) hasPending = true
  }
  if (hasRunning) return 'var(--theme-success-500)'
  if (hasFailed) return 'var(--theme-error-500)'
  if (hasPending) return 'var(--theme-elevation-600)'
  return 'var(--theme-elevation-300)'
}

// ─── Section Header with popover ───

function SectionHeader({
  label,
  jobs,
  jobQueue,
  adminRoute,
  pathname,
}: {
  label: string
  jobs?: JobDef[]
  jobQueue: JobQueueEntry[]
  adminRoute: string
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hasJobs = jobs && jobs.length > 0
  const dotColor = hasJobs ? aggregateDotColor(jobs, jobQueue) : undefined

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--theme-elevation-450)',
          flex: 1,
        }}>
          {label}
        </span>
        {hasJobs && (
          <>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              backgroundColor: dotColor, flexShrink: 0,
              transition: 'background-color 0.2s',
            }} />
            <button
              type="button"
              onClick={() => setOpen(!open)}
              title="Jobs"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '20px', height: '20px', borderRadius: '4px',
                background: open ? 'var(--theme-elevation-100)' : 'transparent',
                border: 'none', cursor: 'pointer', padding: 0,
                color: 'var(--theme-elevation-400)',
                transition: 'background 0.1s, color 0.1s',
                flexShrink: 0,
              }}
              onMouseEnter={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.color = 'var(--theme-text)'; if (!open) (e.currentTarget as HTMLElement).style.background = 'var(--theme-elevation-50)' }}
              onMouseLeave={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.color = 'var(--theme-elevation-400)'; if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="13" cy="8" r="1.5" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Popover */}
      {open && hasJobs && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          right: 0,
          zIndex: 100,
          backgroundColor: 'var(--theme-elevation-0)',
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: '6px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
          padding: '4px',
          minWidth: '160px',
        }}>
          {jobs.map((job) => {
            const entry = jobQueue.find(e => e.collection === job.slug)
            const dotColor = jobDotColor(entry)
            const title = jobTitle(entry)
            const isActive = pathname.startsWith(`${adminRoute}/collections/${job.slug}`)

            return (
              <Link
                key={job.slug}
                href={`${adminRoute}/collections/${job.slug}`}
                prefetch={false}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  color: 'var(--theme-text)',
                  textDecoration: 'none',
                  fontSize: '13px',
                  lineHeight: '1.35',
                  background: isActive ? 'var(--theme-elevation-100)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                title={title}
                onMouseEnter={(e: React.MouseEvent) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--theme-elevation-50)' }}
                onMouseLeave={(e: React.MouseEvent) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: dotColor, flexShrink: 0,
                }} />
                <span style={{ flex: 1 }}>{job.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───

export function CustomNav() {
  const { hydrated, navOpen, navRef, setNavOpen, shouldAnimate } = useNav()
  const { config } = useConfig()
  const pathname = usePathname()
  const adminRoute = config.routes.admin

  const [activeTab, setActiveTab] = useState('products')
  const [jobQueue, setJobQueue] = useState<JobQueueEntry[]>([])

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
        for (const job of section.jobs ?? []) {
          if (pathname.startsWith(`${adminRoute}/collections/${job.slug}`)) {
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
    fetchJobStatus()
    const interval = setInterval(fetchJobStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchJobStatus])

  if (!hydrated) {
    return (
      <aside className="nav">
        <div className="nav__scroll" ref={navRef}>
          <nav className="nav__wrap" />
        </div>
      </aside>
    )
  }

  const currentTab = TABS.find(t => t.id === activeTab) ?? TABS[0]

  const asideClasses = [
    'nav',
    navOpen && 'nav--nav-open',
    shouldAnimate && 'nav--nav-animate',
    hydrated && 'nav--nav-hydrated',
  ].filter(Boolean).join(' ')

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

          {/* ── Sections ── */}
          <div style={{ width: '100%' }}>
          {currentTab.sections.map((section, si) => (
            <div key={si} style={{ marginTop: si > 0 ? '4px' : '0' }}>
              {section.label && (
                <div style={{ padding: '10px 0 4px' }}>
                  <SectionHeader
                    label={section.label}
                    jobs={section.jobs}
                    jobQueue={jobQueue}
                    adminRoute={adminRoute}
                    pathname={pathname}
                  />
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
            <button
              className="nav__mobile-close"
              onClick={() => setNavOpen(false)}
              tabIndex={navOpen ? undefined : -1}
              type="button"
            >
              <Hamburger isActive={true} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
              <Link href={`${adminRoute}/`} prefetch={false} className="cnav-header-btn" title="Dashboard">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </Link>
              <Link href={`${adminRoute}/globals/changelog`} prefetch={false} className="cnav-header-btn" title="Changelog">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v4l3 3" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </Link>
              <Link href={`${adminRoute}/logout`} prefetch={false} className="cnav-header-btn" title="Logout">
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
