import { rewriteResponseHeaders } from './headers'
import { isPreviewHost } from './origins'
import { SCRIPT_TAG, scriptHash } from './script'

export type Upstream = (request: Request) => Promise<Response>

const NOT_FOUND_STATUS = 404
const SWITCHING_PROTOCOLS_STATUS = 101

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

function isHtml(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
}

function injectScript(response: Response): Response {
  let injected = false
  const inject = (element: {
    prepend: (content: string, options: { html: boolean }) => unknown
  }) => {
    if (injected) return
    injected = true
    element.prepend(SCRIPT_TAG, { html: true })
  }
  return new HTMLRewriter()
    .on('head', { element: inject })
    .on('body', { element: inject })
    .transform(response)
}

export async function handlePreviewRequest(args: {
  request: Request
  upstream: Upstream
}): Promise<Response> {
  const { request, upstream } = args
  const hostname = URL.canParse(request.url) ? new URL(request.url).hostname : ''
  if (!isPreviewHost(hostname)) return new Response('Not found', { status: NOT_FOUND_STATUS })
  const response = await upstream(request)
  if (isWebSocketUpgrade(request) || response.status === SWITCHING_PROTOCOLS_STATUS) return response
  const html = isHtml(response)
  const headers = rewriteResponseHeaders({
    headers: response.headers,
    scriptHash: html ? await scriptHash() : null,
    dropContentLength: html,
  })
  const rewritten = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
  return html ? injectScript(rewritten) : rewritten
}

export default {
  fetch(request: Request): Promise<Response> {
    return handlePreviewRequest({ request, upstream: (outgoing) => fetch(outgoing) })
  },
}
