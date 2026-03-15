/**
 * Centralized OpenAI client singleton.
 *
 * All LLM calls in the worker go through this single instance.
 * Supports OpenAI-API-compatible servers via OPENAI_BASE_URL env var.
 *
 * Env vars:
 *   OPENAI_API_KEY   — required, API key for authentication
 *   OPENAI_BASE_URL  — optional, base URL for an OpenAI-compatible server
 *                      (default: https://api.openai.com/v1)
 */

import OpenAI from 'openai'

let instance: OpenAI | null = null

export function getOpenAI(): OpenAI {
  if (!instance) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }

    const baseURL = process.env.OPENAI_BASE_URL || undefined

    instance = new OpenAI({ apiKey, baseURL })
  }
  return instance
}
