import { z } from 'zod'

export const POSTHOG_HOST = 'https://us.posthog.com'
export const POSTHOG_PROJECT_ID = 411591
export const POSTHOG_KEY_ENV = 'POSTHOG_PERSONAL_API_KEY'
export const POSTHOG_PAGE_LIMIT = 100

export class PosthogApiError extends Error {
  readonly status: number
  readonly path: string
  readonly detail: string

  constructor({ status, path, detail }: { status: number; path: string; detail: string }) {
    super(`posthog ${status} on ${path}: ${detail}`)
    this.name = 'PosthogApiError'
    this.status = status
    this.path = path
    this.detail = detail
  }
}

export type PosthogRequest = {
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  query?: Readonly<Record<string, string>>
  body?: unknown
}

export type PosthogApi = {
  request: (args: PosthogRequest) => Promise<unknown>
  hogql: (args: { query: string }) => Promise<readonly Record<string, unknown>[]>
  listAll: (args: {
    path: string
    query?: Readonly<Record<string, string>>
  }) => Promise<readonly Record<string, unknown>[]>
}

const hogqlResponseSchema = z.object({
  columns: z.array(z.string()),
  results: z.array(z.array(z.unknown())),
  error: z.string().nullish(),
})

const pageSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())),
  next: z.string().nullish(),
})

const detailOf = ({ body, statusText }: { body: string; statusText: string }): string =>
  body === '' ? statusText : body.slice(0, 500)

export const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

export function chunkValues<T>({ values, size }: { values: readonly T[]; size: number }): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size))
  return chunks
}

export function createPosthogApi({
  apiKey,
  host = POSTHOG_HOST,
  projectId = POSTHOG_PROJECT_ID,
  fetchImpl = fetch,
}: {
  apiKey: string
  host?: string
  projectId?: number
  fetchImpl?: typeof fetch
}): PosthogApi {
  const request = async ({ method, path, query = {}, body }: PosthogRequest): Promise<unknown> => {
    const url = new URL(`${host}/api/projects/${projectId}${path}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok)
      throw new PosthogApiError({
        status: response.status,
        path,
        detail: detailOf({ body: text, statusText: response.statusText }),
      })
    if (text === '') return null
    return JSON.parse(text) as unknown
  }

  const hogql = async ({
    query,
  }: {
    query: string
  }): Promise<readonly Record<string, unknown>[]> => {
    const raw = await request({
      method: 'POST',
      path: '/query/',
      body: { query: { kind: 'HogQLQuery', query }, refresh: 'force_blocking' },
    })
    const parsed = hogqlResponseSchema.parse(raw)
    if (parsed.error !== undefined && parsed.error !== null)
      throw new PosthogApiError({ status: 200, path: '/query/', detail: parsed.error })
    return parsed.results.map((row) =>
      Object.fromEntries(parsed.columns.map((column, index) => [column, row[index]])),
    )
  }

  const listAll = async ({
    path,
    query = {},
  }: {
    path: string
    query?: Readonly<Record<string, string>>
  }): Promise<readonly Record<string, unknown>[]> => {
    const rows: Record<string, unknown>[] = []
    let offset = 0
    for (;;) {
      const raw = await request({
        method: 'GET',
        path,
        query: { ...query, limit: String(POSTHOG_PAGE_LIMIT), offset: String(offset) },
      })
      const page = pageSchema.parse(raw)
      rows.push(...page.results)
      if (page.next === undefined || page.next === null) return rows
      offset += POSTHOG_PAGE_LIMIT
    }
  }

  return { request, hogql, listAll }
}
