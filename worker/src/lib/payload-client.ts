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
}

interface FindByIDArgs {
  collection: string
  id: number
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
    if (args.sort) parts.push(`sort=${encodeURIComponent(args.sort)}`)
    const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
    return this.request('GET', `/${args.collection}${qs}`) as Promise<FindResult<T>>
  }

  async findByID<T = Record<string, unknown>>(args: FindByIDArgs): Promise<T> {
    const result = await this.request('GET', `/${args.collection}/${args.id}`)
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

  async me(): Promise<{ user: Record<string, unknown> | null }> {
    return this.request('GET', '/workers/me') as Promise<{ user: Record<string, unknown> | null }>
  }
}
