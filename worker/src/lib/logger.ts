import type { PayloadRestClient } from '@/lib/payload-client'

// ---------------------------------------------------------------------------
// Job collection type — all 8 job collections that can have events
// ---------------------------------------------------------------------------

export type JobCollection =
  | 'product-discoveries'
  | 'product-searches'
  | 'product-crawls'
  | 'ingredients-discoveries'
  | 'product-aggregations'
  | 'video-discoveries'
  | 'video-processings'
  | 'ingredient-crawls'

// ---------------------------------------------------------------------------
// Event types & options
// ---------------------------------------------------------------------------

export type EventType = 'start' | 'success' | 'info' | 'warning' | 'error'

export interface EventOpts {
  /** true = derive event type from log level; or pass explicit type */
  event?: boolean | EventType
  /** Labels for filtering/categorizing events */
  labels?: string[]
}

// ---------------------------------------------------------------------------
// Structured log data — flat key/value pairs attached to every log call
// ---------------------------------------------------------------------------

/** Flat key-value pairs that travel with a log entry. Keep values scalar. */
export type LogData = Record<string, string | number | boolean | null | undefined>

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_TO_EVENT: Record<LogLevel, EventType> = {
  debug: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
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
  debug(msg: string, data?: LogData, opts?: EventOpts): void
  info(msg: string, data?: LogData, opts?: EventOpts): void
  warn(msg: string, data?: LogData, opts?: EventOpts): void
  error(msg: string, data?: LogData, opts?: EventOpts): void

  // Backward compat: allow passing EventOpts directly as second arg
  debug(msg: string, opts?: EventOpts): void
  info(msg: string, opts?: EventOpts): void
  warn(msg: string, opts?: EventOpts): void
  error(msg: string, opts?: EventOpts): void

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
        ...(labels?.length ? { labels: labels.map((l) => ({ label: l })) } : {}),
        ...(cleanData ? { data: cleanData } : {}),
      },
    })
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// Detect whether second argument is LogData or EventOpts
//
// EventOpts has { event?, labels? }. LogData has arbitrary keys.
// We check: if the object ONLY has keys from EventOpts, treat it as opts.
// ---------------------------------------------------------------------------

const EVENT_OPTS_KEYS = new Set(['event', 'labels'])

function isEventOpts(arg: unknown): arg is EventOpts {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return false
  const keys = Object.keys(arg)
  return keys.length > 0 && keys.every((k) => EVENT_OPTS_KEYS.has(k))
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
    arg2?: LogData | EventOpts,
    arg3?: EventOpts,
  ): void {
    // Parse overloaded arguments
    let data: LogData | undefined
    let opts: EventOpts | undefined

    if (arg2 !== undefined) {
      if (isEventOpts(arg2)) {
        opts = arg2
      } else {
        data = arg2 as LogData
        opts = arg3
      }
    }

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

    // Event emission (only when explicitly requested AND a job is bound)
    if (opts?.event && job) {
      const eventType =
        typeof opts.event === 'string' ? opts.event : LEVEL_TO_EVENT[level]
      emitEvent(
        eventType,
        level,
        job.collection,
        job.id,
        `[${tag}] ${msg}`,
        opts.labels,
        data,
      )
    }
  }

  return {
    debug: (msg: string, arg2?: LogData | EventOpts, arg3?: EventOpts) => log('debug', msg, arg2, arg3),
    info: (msg: string, arg2?: LogData | EventOpts, arg3?: EventOpts) => log('info', msg, arg2, arg3),
    warn: (msg: string, arg2?: LogData | EventOpts, arg3?: EventOpts) => log('warn', msg, arg2, arg3),
    error: (msg: string, arg2?: LogData | EventOpts, arg3?: EventOpts) => log('error', msg, arg2, arg3),
    forJob(collection: JobCollection, id: number): Logger {
      return makeLogger(tag, { collection, id })
    },
  }
}

export function createLogger(tag: string): Logger {
  return makeLogger(tag)
}
