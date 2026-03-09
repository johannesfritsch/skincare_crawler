import type { PayloadRestClient } from '@/lib/payload-client'
import type { EventRegistry, EventName, EventMeta, LogLevel, JobCollection, EventType } from '@anyskin/shared'
import { EVENT_META } from '@anyskin/shared'

// Re-export shared types for backward compatibility
export type { JobCollection, EventType, LogLevel, EventRegistry, EventName, EventMeta } from '@anyskin/shared'
export { EVENT_META } from '@anyskin/shared'

// ---------------------------------------------------------------------------
// Structured log data — flat key/value pairs attached to every log call
// ---------------------------------------------------------------------------

/** Flat key-value pairs that travel with a log entry. Keep values scalar. */
export type LogData = Record<string, string | number | boolean | null | undefined>

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

// LogLevel is imported from @anyskin/shared above

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// ---------------------------------------------------------------------------
// Console formatting (human-readable mode)
// ---------------------------------------------------------------------------

const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: '\x1b[90mDBG\x1b[0m',
  info: '\x1b[36mINF\x1b[0m',
  warn: '\x1b[33mWRN\x1b[0m',
  error: '\x1b[31mERR\x1b[0m',
}

const DATA_COLOR = '\x1b[90m' // dim gray for key=value pairs
const RESET = '\x1b[0m'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let _client: PayloadRestClient | null = null

const configuredLevel: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  if (env in LEVEL_ORDER) return env as LogLevel
  return 'info'
})()

type LogFormat = 'text' | 'json'

const configuredFormat: LogFormat = (() => {
  const env = (process.env.LOG_FORMAT ?? 'text').toLowerCase()
  if (env === 'json') return 'json'
  return 'text'
})()

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

function timestampPretty(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `\x1b[90m${hh}:${mm}:${ss}\x1b[0m`
}

// ---------------------------------------------------------------------------
// Format structured data as key=value string (for text mode)
// ---------------------------------------------------------------------------

function formatData(data: LogData): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue
    const val = typeof v === 'string' && v.includes(' ') ? `"${v}"` : String(v)
    parts.push(`${k}=${val}`)
  }
  return parts.length > 0 ? `${DATA_COLOR}${parts.join(' ')}${RESET}` : ''
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initLogger(client: PayloadRestClient): void {
  _client = client
}

export interface Logger {
  debug(msg: string, data?: LogData): void
  info(msg: string, data?: LogData): void
  warn(msg: string, data?: LogData): void
  error(msg: string, data?: LogData): void

  /**
   * Emit a typed, named event. The data shape is enforced by the EventRegistry.
   *
   * Usage:
   *   jlog.event('crawl.started', { source: 'dm', items: 42, crawlVariants: true })
   *
   * Defaults for type/level/labels come from EVENT_META; override via `opts`.
   * Only emits to the server when the logger is job-scoped (via `forJob()`).
   */
  event<N extends EventName>(name: N, data: EventRegistry[N], opts?: Partial<EventMeta>): void

  forJob(collection: JobCollection, id: number): Logger
}

// ---------------------------------------------------------------------------
// Event emission (fire-and-forget to server)
// ---------------------------------------------------------------------------

function emitEvent(
  eventType: EventType,
  level: LogLevel,
  collection: JobCollection,
  jobId: number,
  message: string,
  labels?: string[],
  data?: LogData,
  name?: string,
): void {
  if (!_client) return

  // Strip undefined/null values from data before sending
  let cleanData: Record<string, string | number | boolean> | undefined
  if (data) {
    cleanData = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) cleanData[k] = v
    }
    if (Object.keys(cleanData).length === 0) cleanData = undefined
  }

  _client
    .create({
      collection: 'events',
      data: {
        type: eventType,
        level,
        component: 'worker',
        message,
        job: { relationTo: collection, value: jobId },
        ...(name ? { name } : {}),
        ...(labels?.length ? { labels: labels.map((l) => ({ label: l })) } : {}),
        ...(cleanData ? { data: cleanData } : {}),
      },
    })
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

function makeLogger(
  tag: string,
  job?: { collection: JobCollection; id: number },
): Logger {
  function log(
    level: LogLevel,
    msg: string,
    data?: LogData,
  ): void {
    // Console output
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel]) {
      if (configuredFormat === 'json') {
        // JSON mode: one JSON object per line, machine-parseable
        const entry: Record<string, unknown> = {
          ts: new Date().toISOString(),
          level,
          tag,
          msg,
          ...data,
        }
        if (job) {
          entry.jobCollection = job.collection
          entry.jobId = job.id
        }
        const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
        consoleFn(JSON.stringify(entry))
      } else {
        // Text mode: human-readable with ANSI colors
        const dataStr = data ? ` ${formatData(data)}` : ''
        const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'debug' ? console.debug : console.log
        consoleFn(`${timestampPretty()} ${LEVEL_BADGE[level]} \x1b[1m${tag}\x1b[0m ${msg}${dataStr}`)
      }
    }
  }

  return {
    debug: (msg: string, data?: LogData) => log('debug', msg, data),
    info: (msg: string, data?: LogData) => log('info', msg, data),
    warn: (msg: string, data?: LogData) => log('warn', msg, data),
    error: (msg: string, data?: LogData) => log('error', msg, data),

    event<N extends EventName>(eventName: N, data: EventRegistry[N], opts?: Partial<EventMeta>): void {
      const meta = EVENT_META[eventName]
      const resolvedType = opts?.type ?? meta.type
      const resolvedLevel = opts?.level ?? meta.level
      const resolvedLabels = opts?.labels ?? meta.labels

      // Console output — use the event name as the message
      log(resolvedLevel, eventName, data as LogData)

      // Emit server event if job-scoped
      if (job) {
        emitEvent(
          resolvedType,
          resolvedLevel,
          job.collection,
          job.id,
          `[${tag}] ${eventName}`,
          resolvedLabels,
          data as LogData,
          eventName,
        )
      }
    },

    forJob(collection: JobCollection, id: number): Logger {
      return makeLogger(tag, { collection, id })
    },
  }
}

export function createLogger(tag: string): Logger {
  return makeLogger(tag)
}
