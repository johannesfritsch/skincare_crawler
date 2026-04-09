'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { useDashboardState } from '../dashboard-store'
import { WidgetContainer } from './WidgetContainer'

const DOMAIN_COLORS: Record<string, string> = {
  crawl: '#3b82f6',
  scraper: '#6366f1',
  persist: '#8b5cf6',
  discovery: '#22c55e',
  search: '#14b8a6',
  aggregation: '#f59e0b',
  job: '#64748b',
  brand: '#ec4899',
  ingredients: '#06b6d4',
  classification: '#f97316',
  product_match: '#a855f7',
  video_processing: '#ef4444',
  video_discovery: '#10b981',
  ingredient_crawl: '#84cc16',
  ingredients_discovery: '#0ea5e9',
}

function getDomainColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? '#94a3b8'
}

export default function EventDomainsClient() {
  const { data } = useDashboardState()

  if (!data || data.byDomain.length === 0) {
    return (
      <WidgetContainer>
        <div style={{ padding: '8px 0', textAlign: 'center', color: 'var(--theme-elevation-500)', fontSize: '0.875rem' }}>
          No domain data
        </div>
      </WidgetContainer>
    )
  }

  const chartData = data.byDomain.slice(0, 12).map((d) => ({
    domain: d.domain,
    total: d.total,
    errors: d.errors,
  }))

  return (
    <WidgetContainer>
      <div style={{ width: '100%', height: Math.max(220, chartData.length * 32 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" barCategoryGap="20%">
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="domain"
              tick={{ fontSize: 12, fill: 'var(--theme-text)' }}
              tickLine={false}
              axisLine={false}
              width={120}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--theme-elevation-0)',
                border: '1px solid var(--theme-elevation-150)',
                fontSize: '0.8125rem',
              }}
            />
            <Bar dataKey="total" radius={[0, 4, 4, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.domain} fill={getDomainColor(entry.domain)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetContainer>
  )
}
