export type RelayEnv = { API_ORIGIN: string }

export type Upstream = (request: Request) => Promise<Response>

const HOOK_PATH = '/github/app'
const RELAYED_HOOK_PATH = '/v1/github/app/relayed-hook'
const BASE64_CHUNK_BYTES = 0x8000

const FORWARDED_HEADERS = [
  'x-github-event',
  'x-github-delivery',
  'x-hub-signature-256',
  'x-github-hook-id',
  'x-github-hook-installation-target-id',
  'x-github-hook-installation-target-type',
  'user-agent',
] as const

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

function forwardedHeadersOf(request: Request): Headers {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

export async function handleRelayRequest(args: {
  request: Request
  apiOrigin: string
  upstream: Upstream
}): Promise<Response> {
  if (new URL(args.request.url).pathname !== HOOK_PATH) {
    return new Response('Not found', { status: 404 })
  }
  if (args.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
  }

  const payload = base64Of(new Uint8Array(await args.request.arrayBuffer()))
  const target = `${args.apiOrigin.replace(/\/+$/, '')}${RELAYED_HOOK_PATH}`
  try {
    const upstream = await args.upstream(
      new Request(target, {
        method: 'POST',
        headers: forwardedHeadersOf(args.request),
        body: JSON.stringify({ payload }),
      }),
    )
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers })
  } catch {
    return new Response('relay could not reach the api', { status: 502 })
  }
}

export default {
  fetch: (request: Request, env: RelayEnv): Promise<Response> =>
    handleRelayRequest({
      request,
      apiOrigin: env.API_ORIGIN,
      upstream: (target) => fetch(target),
    }),
}
