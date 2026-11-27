export type Upstream = (request: Request) => Promise<Response>

export type TunnelWait = {
  budgetMs: number
  tries: number
  firstDelayMs: number
  maxDelayMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export type TunnelAnswer = { response: Response; tunnelError: boolean }

const CLOUDFLARE_EDGE_STATUSES: ReadonlySet<number> = new Set([502, 530])
const CLOUDFLARE_ERROR_MARKER = 'cf-error-details'
const MARKER_SCAN_CHARS = 65_536
const RETRIED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

export const DEFAULT_TUNNEL_WAIT: TunnelWait = {
  budgetMs: 30_000,
  tries: 15,
  firstDelayMs: 500,
  maxDelayMs: 2_000,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

const readsBodyOfTunnelError = async (response: Response): Promise<boolean> => {
  const body = response.clone().body
  if (body === null) return false
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let seen = ''
  try {
    while (seen.length < MARKER_SCAN_CHARS) {
      const chunk = await reader.read()
      if (chunk.done) break
      seen += decoder.decode(chunk.value, { stream: true })
      if (seen.includes(CLOUDFLARE_ERROR_MARKER)) return true
    }
    return seen.includes(CLOUDFLARE_ERROR_MARKER)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export const isTunnelError = async (response: Response): Promise<boolean> =>
  CLOUDFLARE_EDGE_STATUSES.has(response.status) && (await readsBodyOfTunnelError(response))

export const discardResponse = async (response: Response): Promise<void> => {
  const body = response.body
  if (body === null) return
  await body.cancel().catch(() => undefined)
}

const isWebSocketUpgrade = (request: Request): boolean =>
  request.headers.get('upgrade')?.toLowerCase() === 'websocket'

export const repeatsUpstream = (request: Request): boolean =>
  RETRIED_METHODS.has(request.method) && !isWebSocketUpgrade(request)

export const upstreamWaitingForTunnel = async (args: {
  request: Request
  upstream: Upstream
  wait: TunnelWait
}): Promise<TunnelAnswer> => {
  const { request, upstream, wait } = args
  const first = await upstream(request)
  if (!repeatsUpstream(request)) return { response: first, tunnelError: await isTunnelError(first) }
  const deadline = wait.now() + wait.budgetMs
  let delay = wait.firstDelayMs
  let response = first
  for (let tries = 1; tries < wait.tries; tries += 1) {
    const tunnelError = await isTunnelError(response)
    if (!tunnelError || wait.now() >= deadline) return { response, tunnelError }
    await discardResponse(response)
    await wait.sleep(delay)
    delay = Math.min(delay * 2, wait.maxDelayMs)
    response = await upstream(request)
  }
  return { response, tunnelError: await isTunnelError(response) }
}
