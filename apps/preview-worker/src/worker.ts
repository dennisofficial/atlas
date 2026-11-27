import {
  callbackHostOf,
  framedPreviewCookie,
  handleCallbackRequest,
  previewCookie,
} from './callback'
import { isThirdPartyFrameRequest } from './cookies'
import { rewriteResponseHeaders } from './headers'
import { DEFAULT_PREVIEW_DOMAIN, isPreviewHost } from './origins'
import { scriptHashOf, scriptTagOf } from './script'
import { startingPage } from './starting-page'
import {
  DEFAULT_TUNNEL_WAIT,
  discardResponse,
  type TunnelWait,
  type Upstream,
  upstreamWaitingForTunnel,
} from './tunnel-wait'

export type { Upstream }

export type PreviewEnv = { PREVIEW_DOMAIN?: string | undefined }

const notFound = (): Response => new Response('Not found', { status: 404 })
const SWITCHING_PROTOCOLS_STATUS = 101
const TOP_LEVEL_DESTINATIONS = new Set(['document'])
const FRAMED_DESTINATIONS = new Set(['iframe'])

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

const fetchDestinationOf = (request: Request): string => request.headers.get('sec-fetch-dest') ?? ''

const loadsDocument = (request: Request): boolean =>
  request.headers.get('sec-fetch-mode') === 'navigate' ||
  TOP_LEVEL_DESTINATIONS.has(fetchDestinationOf(request)) ||
  FRAMED_DESTINATIONS.has(fetchDestinationOf(request))

function markerCookieFor(args: {
  request: Request
  hostname: string
  html: boolean
  domain: string
}): string | null {
  const target = { target: args.hostname, domain: args.domain }
  const destination = args.request.headers.get('sec-fetch-dest')
  if (destination === null) return args.html ? previewCookie(target) : null
  if (TOP_LEVEL_DESTINATIONS.has(destination)) return previewCookie(target)
  if (FRAMED_DESTINATIONS.has(destination)) return framedPreviewCookie(target)
  return null
}

function isHtml(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
}

function injectScript(args: { response: Response; domain: string }): Response {
  let injected = false
  const tag = scriptTagOf(args.domain)
  const inject = (element: {
    prepend: (content: string, options: { html: boolean }) => unknown
  }) => {
    if (injected) return
    injected = true
    element.prepend(tag, { html: true })
  }
  return new HTMLRewriter()
    .on('head', { element: inject })
    .on('body', { element: inject })
    .transform(args.response)
}

export async function handlePreviewRequest(args: {
  request: Request
  upstream: Upstream
  domain?: string | undefined
  tunnelWait?: TunnelWait | undefined
}): Promise<Response> {
  const { request, upstream } = args
  const domain = args.domain ?? DEFAULT_PREVIEW_DOMAIN
  const hostname = URL.canParse(request.url) ? new URL(request.url).hostname : ''
  if (hostname === callbackHostOf(domain)) return handleCallbackRequest({ request, domain })
  if (!isPreviewHost(hostname, domain)) return notFound()
  const answer = await upstreamWaitingForTunnel({
    request,
    upstream,
    wait: args.tunnelWait ?? DEFAULT_TUNNEL_WAIT,
  })
  if (isWebSocketUpgrade(request) || answer.response.status === SWITCHING_PROTOCOLS_STATUS) {
    return answer.response
  }
  const waiting = answer.tunnelError && loadsDocument(request)
  if (waiting) await discardResponse(answer.response)
  const response = waiting ? startingPage() : answer.response
  const html = isHtml(response)
  const headers = rewriteResponseHeaders({
    headers: response.headers,
    scriptHash: html ? await scriptHashOf(domain) : null,
    dropContentLength: html,
    partitionCookies: isThirdPartyFrameRequest(request),
  })
  const marker = markerCookieFor({ request, hostname, html, domain })
  if (marker !== null) headers.append('set-cookie', marker)
  const rewritten = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
  return html ? injectScript({ response: rewritten, domain }) : rewritten
}

export default {
  fetch(request: Request, env: PreviewEnv = {}): Promise<Response> {
    return handlePreviewRequest({
      request,
      upstream: (outgoing) => fetch(outgoing),
      domain: env.PREVIEW_DOMAIN,
    })
  },
}
