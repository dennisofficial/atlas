import { CloudflareRecordExistsError, PreviewUpstreamError } from './errors'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const REQUEST_TIMEOUT_MS = 30_000

export type CloudflareConfig = { apiToken: string; accountId: string; zoneId: string }

export interface CloudflareHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface CloudflareHttpResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type CloudflareFetchFn = (
  url: string,
  request: CloudflareHttpRequest,
) => Promise<CloudflareHttpResponse>

const defaultCloudflareFetch: CloudflareFetchFn = (url, request) => fetch(url, request)

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  } catch {
    return {}
  }
}

const RECORD_EXISTS_CODES = [81053, 81057]

function isRecordExists(body: Record<string, unknown>): boolean {
  const errors = body.errors
  if (!Array.isArray(errors)) return false
  return errors.some((error: unknown) => {
    if (typeof error !== 'object' || error === null) return false
    const code = 'code' in error ? error.code : undefined
    const message = 'message' in error ? error.message : undefined
    return (
      (typeof code === 'number' && RECORD_EXISTS_CODES.includes(code)) ||
      (typeof message === 'string' && message.toLowerCase().includes('already exist'))
    )
  })
}

function errorMessages(body: Record<string, unknown>): string[] {
  const errors = body.errors
  if (!Array.isArray(errors)) return []
  return errors.flatMap((error: unknown) => {
    if (typeof error !== 'object' || error === null || !('message' in error)) return []
    return typeof error.message === 'string' ? [error.message] : []
  })
}

function objectsOf(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    return [Object.fromEntries(Object.entries(entry))]
  })
}

export function resultOf(body: Record<string, unknown>): Record<string, unknown> {
  const { result } = body
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? Object.fromEntries(Object.entries(result))
    : {}
}

export function resultsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return objectsOf(body.result)
}

export function totalPagesOf(body: Record<string, unknown>): number {
  const info = objectsOf([body.result_info])[0]
  const total = info === undefined ? undefined : info.total_pages
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 1
}

export function stringOf(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function requireString(args: {
  result: Record<string, unknown>
  key: string
  operation: string
}): string {
  const value = stringOf(args.result, args.key)
  if (value === undefined) {
    throw new PreviewUpstreamError(
      `cloudflare ${args.operation} returned an unexpected response (missing ${args.key})`,
    )
  }
  return value
}

export type CloudflareRequestArgs = {
  operation: string
  method: CloudflareHttpRequest['method']
  path: string
  payload?: unknown
  tolerateMissing?: boolean
}

export class CloudflareRequest {
  private readonly fetchFn: CloudflareFetchFn

  constructor(
    private readonly config: CloudflareConfig,
    args: { fetchFn?: CloudflareFetchFn } = {},
  ) {
    this.fetchFn = args.fetchFn ?? defaultCloudflareFetch
  }

  async send(args: CloudflareRequestArgs): Promise<Record<string, unknown>> {
    return resultOf(await this.request(args))
  }

  async request(args: CloudflareRequestArgs): Promise<Record<string, unknown>> {
    const response = await this.fetchFn(`${API_BASE}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      ...(args.payload === undefined ? {} : { body: JSON.stringify(args.payload) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (args.tolerateMissing === true && response.status === 404) return {}
    const body = parseJson(await response.text())
    if (response.ok && body.success !== false) return body
    if (isRecordExists(body)) {
      throw new CloudflareRecordExistsError(
        `cloudflare ${args.operation} failed: record already exists`,
      )
    }
    const messages = errorMessages(body)
    throw new PreviewUpstreamError(
      messages.length > 0
        ? `cloudflare ${args.operation} failed: ${messages.join('; ')}`
        : `cloudflare ${args.operation} failed with status ${response.status}`,
    )
  }
}
