/**
 * Centralized OpenAI client singleton.
 *
 * All LLM calls in the worker go through this single instance.
 * Supports OpenAI-API-compatible servers via OPENAI_BASE_URL env var.
 *
 * Env vars:
 *   OPENAI_API_KEY       — required, API key for authentication
 *   OPENAI_BASE_URL      — optional, base URL for an OpenAI-compatible server
 *                          (default: https://api.openai.com/v1)
 *   OPENAI_TIMEOUT_MS    — optional, request timeout in ms (default: 120000 = 2 min)
 *   OPENAI_MAX_RETRIES   — optional, max retries for transient errors (default: 2)
 */

import OpenAI from 'openai'

/** Default timeout: 5 minutes (SDK default is 10 minutes which is too long) */
const DEFAULT_TIMEOUT_MS = 300_000

/** Default retries for transient HTTP errors (429, 500, 503) */
const DEFAULT_MAX_RETRIES = 2

let instance: OpenAI | null = null

export function getOpenAI(): OpenAI {
  if (!instance) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }

    const baseURL = process.env.OPENAI_BASE_URL || undefined
    const timeout = Number(process.env.OPENAI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
    const maxRetries = Number(process.env.OPENAI_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES

    instance = new OpenAI({ apiKey, baseURL, timeout, maxRetries })
  }
  return instance
}
