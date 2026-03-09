/**
 * Module-level store for shared dashboard data.
 *
 * The DashboardProvider (rendered via beforeDashboard) owns the data-fetching
 * and writes into this store. Widget client components subscribe via
 * useDashboardData(). Uses useSyncExternalStore for React 19 compatibility.
 *
 * This follows the same pub/sub pattern used by BulkJobBar.tsx (getJobState/setJobState).
 */

import { useSyncExternalStore } from 'react'
import type { DashboardResponse } from '@/endpoints/dashboard-events'

export type DashboardRange = '1h' | '24h' | '7d' | '30d'

interface DashboardState {
  data: DashboardResponse | null
  range: DashboardRange
  loading: boolean
  error: string | null
}

let state: DashboardState = {
  data: null,
  range: '1h',
  loading: true,
  error: null,
}

const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function getDashboardState(): DashboardState {
  return state
}

export function setDashboardData(data: DashboardResponse) {
  state = { ...state, data, loading: false, error: null }
  notify()
}

export function setDashboardRange(range: DashboardRange) {
  state = { ...state, range, loading: true }
  notify()
}

export function setDashboardLoading(loading: boolean) {
  state = { ...state, loading }
  notify()
}

export function setDashboardError(error: string) {
  state = { ...state, error, loading: false }
  notify()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): DashboardState {
  return state
}

function getServerSnapshot(): DashboardState {
  return state
}

export function useDashboardState(): DashboardState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
