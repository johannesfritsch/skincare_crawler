'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { useDashboardState } from '../dashboard-store'
import { WidgetContainer } from './WidgetContainer'

function formatBucket(bucket: string, range: string): string {
  const d = new Date(bucket)
  if (range === '1h' || range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function EventTimelineClient() {
  const { data } = useDashboardState()

  if (!data || data.timeline.length === 0) {
    return (
      <WidgetContainer>
        <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--theme-elevation-500)', fontSize: '0.875rem' }}>
          No events in this time range
        </div>
      </WidgetContainer>
    )
  }

  const chartData = data.timeline.map((t) => ({
    bucket: formatBucket(t.bucket, data.range),
    Info: t.total - t.errors - t.warnings,
    Warnings: t.warnings,
    Errors: t.errors,
  }))

  return (
    <WidgetContainer>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="15%">
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--theme-elevation-150)"
              vertical={false}
            />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--theme-elevation-150)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--theme-elevation-0)',
                border: '1px solid var(--theme-elevation-150)',
                fontSize: '0.8125rem',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '0.75rem' }}
            />
            <Bar dataKey="Info" stackId="a" fill="#3b82f6" />
            <Bar dataKey="Warnings" stackId="a" fill="#f59e0b" />
            <Bar dataKey="Errors" stackId="a" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetContainer>
  )
}
