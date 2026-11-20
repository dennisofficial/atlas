import { retrySleep, type RetryPolicy } from '../constants'
import { agent37UsageClient, type Agent37UsageClient } from './agent37-usage'

const API_BASE = 'https://api.agent37.com'
const EXEC_BASE = 'https://sandbox.agent37.app'
const QUICK_TIMEOUT_MS = 30_000

export type Agent37Status =
  | 'provisioning'
  | 'starting'
  | 'running'
  | 'updating'
  | 'sleeping'
  | 'waking'
  | 'stopped'

export type Agent37Instance = {
  id: string
  status: Agent37Status
  url: string
  name?: string | undefined
  metadata?: Record<string, string> | undefined
  /** Creation time in epoch seconds. */
  created?: number | undefined
  resources?: Agent37Resources | undefined
}

export type Agent37Resources = { cpu: number; memory: number; disk: number }

export type Agent37CreateArgs = {
  template: string
  type: 'vm'
  region: 'us'
  name: string
  metadata: Record<string, string>
  resources: Agent37Resources
  mount_path: string
  auto_sleep: boolean
  idle_timeout_seconds: number
  env: Record<string, string>
}

export type Agent37ResizeArgs = {
  id: string
  cpu?: number | undefined
  memory?: number | undefined
  disk?: number | undefined
}

export type Agent37ExecResult = {
  exit_code: number
  stdout: string
  stderr: string
  truncated: boolean
}

export type Agent37Pid = { pid: number }

export type Agent37Answer = { status: number; body: string }

export type Agent37ExecArgs = {
  id: string
  command: string
  background?: boolean
  name?: string
  user?: 'root'
}

export type Agent37Client = Agent37UsageClient & {
  create(args: Agent37CreateArgs): Promise<Agent37Instance>
  get(args: { id: string }): Promise<Agent37Instance>
  list(args?: { cursor?: string }): Promise<{ data: Agent37Instance[]; next?: string }>
  remove(args: { id: string }): Promise<void>
  sleep(args: { id: string }): Promise<void>
  start(args: { id: string }): Promise<Pick<Agent37Instance, 'id' | 'status'>>
  resize(args: Agent37ResizeArgs): Promise<Agent37Instance>
  exec(args: Agent37ExecArgs): Promise<Agent37ExecResult | Agent37Pid>
  probe(args: {
    id: string
    port: number
    path?: string
    method?: 'GET' | 'POST'
    authorization?: string
  }): Promise<Agent37Answer>
  signedUrl(args: { id: string; port: number; ttlSeconds: number }): Promise<string>
}

export class Agent37Error extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly detail: string | undefined

  constructor(args: {
    status: number
    code: string
    retryable: boolean
    detail?: string | undefined
  }) {
    super(`agent37 refused the call: ${args.status} ${args.code}`)
    this.name = 'Agent37Error'
    this.status = args.status
    this.code = args.code
    this.retryable = args.retryable
    this.detail = args.detail
  }
}

/** A late delete of an instance that is already gone must still count as success. */
export const isAgent37Missing = (failure: unknown): boolean =>
  failure instanceof Agent37Error && (failure.status === 404 || failure.code === 'not_found')

// https://www.agent37.com/docs/agents-api/exec — a `409 try_again` follows a checkpoint or a host
// move and clears within about a minute, so the budget spans one.
export const agent37ExecRetry: RetryPolicy = { attempts: 10, delayMs: 6_000 }

const TRANSPORT_STATUSES = new Set([502, 503])

// https://www.agent37.com/docs/agents-api/errors — sandbox.agent37.app answers a flat
// `{"error": "not_found"}` instead of the `{"error": {"code": …}}` envelope.
const errorCodeOf = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
  const error = body.error
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

const errorDetailOf = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
  const error = body.error
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined
  return typeof error.message === 'string' ? error.message : undefined
}

// Only a 409 `try_again` clears on its own: `instance_limit_reached` and `capacity_unavailable`
// are answers about the account, so retrying them for a minute spends the wake without changing it.
const retryableOf = (args: { status: number; code: string }): boolean =>
  TRANSPORT_STATUSES.has(args.status) || (args.status === 409 && args.code === 'try_again')

export const liveAgent37Client = (args: {
  apiKey: string
  fetch?: typeof fetch | undefined
  retry?: RetryPolicy | undefined
}): Agent37Client => {
  const transport = args.fetch ?? fetch
  const retry = args.retry ?? agent37ExecRetry

  const call = async (request: {
    url: string
    method: string
    headers: Record<string, string>
    body?: unknown
    timeoutMs?: number
  }): Promise<unknown> => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await transport(request.url, {
        method: request.method,
        headers: {
          ...request.headers,
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(request.timeoutMs ?? QUICK_TIMEOUT_MS),
      })
      const text = await response.text()
      const body: unknown = text === '' ? undefined : JSON.parse(text)
      if (response.ok) return body
      const code = errorCodeOf(body) ?? 'unknown'
      const retryable = retryableOf({ status: response.status, code })
      if (!retryable || attempt >= retry.attempts) {
        const detail = errorDetailOf(body)
        throw new Agent37Error({
          status: response.status,
          code,
          retryable,
          ...(detail === undefined ? {} : { detail }),
        })
      }
      await retrySleep(retry)
    }
  }

  const api = (path: string): string => `${API_BASE}${path}`
  const exec = (path: string): string => `${EXEC_BASE}${path}`
  const bearer = { Authorization: `Bearer ${args.apiKey}` }
  const instanceKey = { 'X-Agent37-Key': args.apiKey }

  return {
    create: (body) =>
      call({
        url: api('/v1/instances'),
        method: 'POST',
        headers: bearer,
        body,
        timeoutMs: 15 * 60_000,
      }) as Promise<Agent37Instance>,
    get: ({ id }) =>
      call({
        url: api(`/v1/instances/${id}`),
        method: 'GET',
        headers: bearer,
      }) as Promise<Agent37Instance>,
    list: ({ cursor } = {}) =>
      call({
        url: cursor === undefined ? api('/v1/instances') : api(`/v1/instances?cursor=${cursor}`),
        method: 'GET',
        headers: bearer,
      }) as Promise<{ data: Agent37Instance[]; next?: string }>,
    remove: async ({ id }) => {
      await call({ url: api(`/v1/instances/${id}`), method: 'DELETE', headers: bearer })
    },
    sleep: async ({ id }) => {
      await call({ url: api(`/v1/instances/${id}/sleep`), method: 'POST', headers: bearer })
    },
    // https://www.agent37.com/docs/agents-api/instances/start — answers only `id` and `status`.
    start: ({ id }) =>
      call({
        url: api(`/v1/instances/${id}/start`),
        method: 'POST',
        headers: bearer,
        timeoutMs: 15 * 60_000,
      }) as Promise<Pick<Agent37Instance, 'id' | 'status'>>,
    // https://www.agent37.com/docs/agents-api/instances/resize — a host move can run past the
    // request and answer 202 while the instance is still `updating`, so this waits like create.
    resize: ({ id, cpu, memory, disk }) =>
      call({
        url: api(`/v1/instances/${id}/resize`),
        method: 'POST',
        headers: bearer,
        body: {
          ...(cpu === undefined ? {} : { cpu }),
          ...(memory === undefined ? {} : { memory }),
          ...(disk === undefined ? {} : { disk }),
        },
        timeoutMs: 15 * 60_000,
      }) as Promise<Agent37Instance>,
    exec: (body) =>
      call({
        url: exec(`/v1/instances/${body.id}/exec`),
        method: 'POST',
        headers: instanceKey,
        body: {
          command: body.command,
          ...(body.background === undefined ? {} : { background: body.background }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.user === undefined ? {} : { user: body.user }),
        },
        timeoutMs: 15 * 60_000,
      }) as Promise<Agent37ExecResult | Agent37Pid>,
    // https://www.agent37.com/docs/agents-api/urls — every port answers at its preview URL, with a
    // transport error until something listens, so a probe reports the failure instead of throwing.
    probe: async ({ id, port, path = '/', method = 'GET', authorization }) => {
      try {
        const response = await transport(`https://${id}-${port}.agent37.app${path}`, {
          method,
          headers: {
            ...instanceKey,
            ...(authorization === undefined ? {} : { Authorization: authorization }),
          },
          signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
        })
        return { status: response.status, body: await response.text() }
      } catch {
        return { status: 0, body: '' }
      }
    },
    ...agent37UsageClient((path) => call({ url: api(path), method: 'GET', headers: bearer })),
    signedUrl: async ({ id, port, ttlSeconds }) => {
      const answer = (await call({
        url: api(`/v1/instances/${id}/signed-url`),
        method: 'POST',
        headers: bearer,
        body: { port, ttl_seconds: ttlSeconds },
      })) as { url: string }
      return answer.url
    },
  }
}
