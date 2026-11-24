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

export type Upstream = (request: Request) => Promise<Response>

export type PreviewEnv = { PREVIEW_DOMAIN?: string | undefined }

const notFound = (): Response => new Response('Not found', { status: 404 })
const SWITCHING_PROTOCOLS_STATUS = 101
const TOP_LEVEL_DESTINATIONS = new Set(['document'])
const FRAMED_DESTINATIONS = new Set(['iframe'])

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

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
}): Promise<Response> {
  const { request, upstream } = args
  const domain = args.domain ?? DEFAULT_PREVIEW_DOMAIN
  const hostname = URL.canParse(request.url) ? new URL(request.url).hostname : ''
  if (hostname === callbackHostOf(domain)) return handleCallbackRequest({ request, domain })
  if (!isPreviewHost(hostname, domain)) return notFound()
  const response = await upstream(request)
  if (isWebSocketUpgrade(request) || response.status === SWITCHING_PROTOCOLS_STATUS) return response
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
