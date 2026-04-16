/**
 * REST client that mirrors the subset of Payload's local API used by worker code.
 * All moved files swap `payload: Payload` → `client: PayloadRestClient` with zero logic changes.
 */

export type Where = Record<string, unknown>

interface FindArgs {
  collection: string
  where?: Where
  limit?: number
  sort?: string
  depth?: number
}

interface FindByIDArgs {
  collection: string
  id: number
  depth?: number
}

interface CreateArgs {
  collection: string
  data: Record<string, unknown>
  file?: { data: Buffer; mimetype: string; name: string; size: number }
}

interface UpdateByIDArgs {
  collection: string
  id: number
  data: Record<string, unknown>
  headers?: Record<string, string>
}

interface UpdateByWhereArgs {
  collection: string
  where: Where
  data: Record<string, unknown>
  headers?: Record<string, string>
}

type UpdateArgs = UpdateByIDArgs | UpdateByWhereArgs

interface DeleteArgs {
  collection: string
  where: Where
}

interface CountArgs {
  collection: string
  where?: Where
}

interface FindResult<T = Record<string, unknown>> {
  docs: T[]
  totalDocs: number
}

interface CountResult {
  totalDocs: number
}

function encodeWhere(where: unknown, prefix = 'where'): string {
  const params: string[] = []

  function flatten(obj: unknown, path: string): void {
    if (obj === null || obj === undefined) {
      params.push(`${encodeURIComponent(path)}=`)
      return
    }
    if (typeof obj !== 'object') {
      params.push(`${encodeURIComponent(path)}=${encodeURIComponent(String(obj))}`)
      return
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        flatten(obj[i], `${path}[${i}]`)
      }
      return
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      flatten(value, `${path}[${key}]`)
    }
  }

  flatten(where, prefix)
  return params.join('&')
}

export class PayloadRestClient {
  private baseUrl: string
  private apiKey: string

  /** The server base URL (e.g. http://localhost:3000), for constructing media download URLs */
  get serverUrl(): string {
    return this.baseUrl
  }

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
  }

  private headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `workers API-Key ${this.apiKey}`,
    }
    if (contentType) h['Content-Type'] = contentType
    return h
  }

  private async request(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<unknown> {
    const url = `${this.baseUrl}/api${path}`
    const options: RequestInit = {
      method,
      headers: {
        ...this.headers(body !== undefined ? 'application/json' : undefined),
        ...extraHeaders,
      },
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const res = await fetch(url, options)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Payload REST ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
    }
    return res.json()
  }

  async find<T = Record<string, unknown>>(args: FindArgs): Promise<FindResult<T>> {
    const parts: string[] = []
    if (args.where) parts.push(encodeWhere(args.where))
    if (args.limit !== undefined) parts.push(`limit=${args.limit}`)
    if (args.depth !== undefined) parts.push(`depth=${args.depth}`)
    if (args.sort) parts.push(`sort=${encodeURIComponent(args.sort)}`)
    const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
    return this.request('GET', `/${args.collection}${qs}`) as Promise<FindResult<T>>
  }

  async findByID<T = Record<string, unknown>>(args: FindByIDArgs): Promise<T> {
    const depthParam = args.depth !== undefined ? `?depth=${args.depth}` : ''
    const result = await this.request('GET', `/${args.collection}/${args.id}${depthParam}`)
    return result as T
  }

  async create<T = Record<string, unknown>>(args: CreateArgs): Promise<T> {
    if (args.file) {
      // Multipart upload
      const formData = new FormData()
      const blob = new Blob([args.file.data], { type: args.file.mimetype })
      formData.append('file', blob, args.file.name)
      formData.append('_payload', JSON.stringify(args.data))

      const url = `${this.baseUrl}/api/${args.collection}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `workers API-Key ${this.apiKey}` },
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Payload REST POST /${args.collection} (multipart) → ${res.status}: ${text.slice(0, 300)}`)
      }
      const json = (await res.json()) as { doc: T }
      return json.doc
    }

    const result = (await this.request('POST', `/${args.collection}`, args.data)) as { doc: T }
    return result.doc
  }

  async update<T = Record<string, unknown>>(args: UpdateArgs): Promise<T> {
    if ('id' in args) {
      const result = (await this.request('PATCH', `/${args.collection}/${args.id}`, args.data, args.headers)) as { doc: T }
      return result.doc
    }
    // Bulk update by where
    const qs = encodeWhere(args.where)
    const result = (await this.request('PATCH', `/${args.collection}?${qs}`, args.data, args.headers)) as { docs: T[] }
    return result.docs[0] as T
  }

  async delete(args: DeleteArgs): Promise<void> {
    const qs = encodeWhere(args.where)
    await this.request('DELETE', `/${args.collection}?${qs}`)
  }

  async count(args: CountArgs): Promise<CountResult> {
    const parts: string[] = []
    if (args.where) parts.push(encodeWhere(args.where))
    const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
    return this.request('GET', `/${args.collection}/count${qs}`) as Promise<CountResult>
  }

  async findGlobal<T = Record<string, unknown>>(slug: string): Promise<T> {
    return this.request('GET', `/globals/${slug}`) as Promise<T>
  }

  async me(): Promise<{ user: Record<string, unknown> | null }> {
    return this.request('GET', '/workers/me') as Promise<{ user: Record<string, unknown> | null }>
  }

  // ─── Embeddings API ───

  /** The embeddings sub-client for vector operations */
  readonly embeddings = {
    /** Write embedding vectors for items in a namespace (supports both id-based and upsert-based writes) */
    write: async (namespace: string, items: Array<Record<string, unknown>>): Promise<{ written: number }> => {
      return this.request('POST', `/embeddings/${namespace}/write`, { items }) as Promise<{ written: number }>
    },

    /** Delete embeddings by filter criteria */
    delete: async (namespace: string, where: Record<string, unknown>): Promise<{ deleted: number }> => {
      return this.request('POST', `/embeddings/${namespace}/delete`, { where }) as Promise<{ deleted: number }>
    },

    /** Search for nearest neighbors by cosine similarity */
    search: async (
      namespace: string,
      vector: number[],
      options?: { limit?: number; threshold?: number },
    ): Promise<{ results: Array<Record<string, unknown>> }> => {
      const body: Record<string, unknown> = { vector }
      if (options?.limit) body.limit = options.limit
      if (options?.threshold !== undefined) body.threshold = options.threshold
      return this.request('POST', `/embeddings/${namespace}/search`, body) as Promise<{
        results: Array<Record<string, unknown>>
      }>
    },
  }

  // ─── Ingredients API ───

  /** Bulk upsert ingredients (find-or-create with backfill) */
  async bulkUpsertIngredients(
    ingredients: Array<{
      name: string
      casNumber?: string
      ecNumber?: string
      cosIngId?: string
      chemicalDescription?: string
      functions: string[]
      itemType?: 'ingredient' | 'substance'
      restrictions?: string
      sourceUrl?: string
    }>,
  ): Promise<{ created: number; existing: number; errors: number }> {
    return this.request('POST', '/ingredients-bulk-upsert', { ingredients }) as Promise<{
      created: number
      existing: number
      errors: number
    }>
  }

  // ─── Work Items API ───

  /** Work items sub-client for parallel job processing */
  readonly workItems = {
    /** Seed work items for a job (idempotent) */
    seed: async (opts: {
      jobCollection: string
      jobId: number
      items: Array<{ itemKey: string; stageName: string }>
      maxRetries?: number
    }): Promise<{ seeded: number }> => {
      return this.request('POST', '/work-items/seed', opts) as Promise<{ seeded: number }>
    },

    /** Atomically claim pending work items via SELECT ... FOR UPDATE SKIP LOCKED */
    claim: async (opts: {
      workerId: number
      jobCollection?: string
      jobId?: number
      allowedCollections?: string[]
      limit?: number
      timeoutMinutes?: number
    }): Promise<{ items: Array<{ id: number; job_collection: string; job_id: number; item_key: string; stage_name: string; retry_count: number }> }> => {
      return this.request('POST', '/work-items/claim', opts) as Promise<{
        items: Array<{ id: number; job_collection: string; job_id: number; item_key: string; stage_name: string; retry_count: number }>
      }>
    },

    /** Report work item completion (success or failure) */
    complete: async (opts: {
      workItemId: number
      success: boolean
      error?: string
      resultData?: Record<string, unknown>
      nextStageName?: string | null
      counterUpdates?: Record<string, number>
      spawnItems?: Array<{ itemKey: string; stageName: string }>
      totalDelta?: number
    }): Promise<{ done: boolean; remaining: number; jobStatus?: 'completed' | 'failed' | null }> => {
      return this.request('POST', '/work-items/complete', opts) as Promise<{ done: boolean; remaining: number }>
    },

    /** Refresh claim timestamps to keep work items alive */
    heartbeat: async (workItemIds: number[]): Promise<{ updated: number }> => {
      return this.request('POST', '/work-items/heartbeat', { workItemIds }) as Promise<{ updated: number }>
    },
  }
}
