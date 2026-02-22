import type { PayloadRestClient } from '@/lib/payload-client'

export type JobCollection =
  | 'product-discoveries'
  | 'product-crawls'
  | 'ingredients-discoveries'
  | 'product-aggregations'
  | 'video-discoveries'
  | 'video-processings'
  | 'category-discoveries'

export type EventType = 'start' | 'success' | 'info' | 'warning' | 'error'

export interface EventOpts {
  /** true = derive event type from log level; or pass explicit type */
  event?: boolean | EventType
  /** Labels for filtering/categorizing events */
  labels?: string[]
}

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

const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: '\x1b[90mDBG\x1b[0m',
  info:  '\x1b[36mINF\x1b[0m',
  warn:  '\x1b[33mWRN\x1b[0m',
  error: '\x1b[31mERR\x1b[0m',
}

let _client: PayloadRestClient | null = null

const configuredLevel: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  if (env in LEVEL_ORDER) return env as LogLevel
  return 'info'
})()

function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `\x1b[90m${hh}:${mm}:${ss}\x1b[0m`
}

export function initLogger(client: PayloadRestClient): void {
  _client = client
}

export interface Logger {
  debug(msg: string, opts?: EventOpts): void
  info(msg: string, opts?: EventOpts): void
  warn(msg: string, opts?: EventOpts): void
  error(msg: string, opts?: EventOpts): void
  forJob(collection: JobCollection, id: number): Logger
}

function emitEvent(
  eventType: EventType,
  level: LogLevel,
  collection: JobCollection,
  jobId: number,
  message: string,
  labels?: string[],
): void {
  if (!_client) return
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
      },
    })
    .catch(() => {})
}

function makeLogger(
  tag: string,
  job?: { collection: JobCollection; id: number },
): Logger {
  function log(
    level: LogLevel,
    consoleFn: (...args: unknown[]) => void,
    msg: string,
    opts?: EventOpts,
  ): void {
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel]) {
      consoleFn(`${timestamp()} ${LEVEL_BADGE[level]} \x1b[1m${tag}\x1b[0m ${msg}`)
    }
    if (opts?.event && job) {
      const eventType =
        typeof opts.event === 'string' ? opts.event : LEVEL_TO_EVENT[level]
      emitEvent(eventType, level, job.collection, job.id, `[${tag}] ${msg}`, opts.labels)
    }
  }

  return {
    debug: (msg, opts?) => log('debug', console.debug, msg, opts),
    info: (msg, opts?) => log('info', console.log, msg, opts),
    warn: (msg, opts?) => log('warn', console.warn, msg, opts),
    error: (msg, opts?) => log('error', console.error, msg, opts),
    forJob(collection: JobCollection, id: number): Logger {
      return makeLogger(tag, { collection, id })
    },
  }
}

export function createLogger(tag: string): Logger {
  return makeLogger(tag)
}
