import {
  constants,
  createSecureServer,
  type Http2ServerRequest,
  type Http2ServerResponse,
  type Http2Session,
} from 'node:http2'
import { Readable } from 'node:stream'

const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
])

const NO_BODY_METHODS = new Set(['GET', 'HEAD'])

export interface IHttp2Tls {
  cert: string
  key: string
}

export interface IServedHttp2 {
  port: number
  stop: () => Promise<void>
}

function headerTextOf(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value.join(', ') : value
}

function requestOf({
  request,
  authority,
  signal,
}: {
  request: Http2ServerRequest
  authority: string
  signal: AbortSignal
}): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (name.startsWith(':') || name === 'host' || value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(name === 'cookie' ? '; ' : ', ') : value)
  }
  headers.set('host', authority)
  const body =
    NO_BODY_METHODS.has(request.method) || request.readableEnded
      ? undefined
      : Readable.toWeb(request as Readable)
  return new Request(`https://${authority}${request.url ?? '/'}`, {
    method: request.method,
    headers,
    signal,
    ...(body === undefined ? {} : { body, duplex: 'half' }),
  })
}

function drain(response: Http2ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      response.off('drain', done)
      response.off('close', done)
      resolve()
    }
    response.once('drain', done)
    response.once('close', done)
  })
}

function writeHeaders({
  response,
  result,
}: {
  response: Http2ServerResponse
  result: Response
}): void {
  for (const [name, value] of result.headers) {
    if (DROPPED_RESPONSE_HEADERS.has(name) || name === 'set-cookie') continue
    response.setHeader(name, value)
  }
  const cookies = result.headers.getSetCookie()
  if (cookies.length > 0) response.setHeader('set-cookie', cookies)
  response.writeHead(result.status)
}

async function sendBody({
  response,
  result,
}: {
  response: Http2ServerResponse
  result: Response
}): Promise<void> {
  if (result.body === null) {
    response.end()
    return
  }
  const reader = result.body.getReader()
  response.on('close', () => void reader.cancel().catch(() => undefined))
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!response.write(value)) await drain(response)
    }
    response.end()
  } catch {
    response.destroy()
  }
}

async function respond({
  request,
  response,
  fetch,
}: {
  request: Http2ServerRequest
  response: Http2ServerResponse
  fetch: (request: Request) => Promise<Response>
}): Promise<void> {
  const authority =
    headerTextOf(request.headers[constants.HTTP2_HEADER_AUTHORITY]) ??
    headerTextOf(request.headers.host) ??
    '127.0.0.1'
  const abort = new AbortController()
  request.on('aborted', () => abort.abort())
  request.on('error', () => abort.abort())
  response.on('error', () => abort.abort())
  let result: Response
  try {
    result = await fetch(requestOf({ request, authority, signal: abort.signal }))
  } catch {
    result = new Response('Internal Server Error', { status: 500 })
  }
  if (response.destroyed) return
  try {
    writeHeaders({ response, result })
  } catch {
    response.destroy()
    return
  }
  await sendBody({ response, result })
}

export function serveHttp2({
  hostname,
  port,
  tls,
  fetch,
}: {
  hostname: string
  port: number
  tls: IHttp2Tls
  fetch: (request: Request) => Promise<Response>
}): Promise<IServedHttp2> {
  const sessions = new Set<Http2Session>()
  const server = createSecureServer(
    { cert: tls.cert, key: tls.key, allowHTTP1: true },
    (request, response) => {
      void respond({ request, response, fetch })
    },
  )
  server.on('session', (session) => {
    sessions.add(session)
    session.on('close', () => sessions.delete(session))
    session.on('error', () => undefined)
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('tlsClientError', () => undefined)
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.close()
      reject(error)
    }
    server.once('error', onError)
    server.listen(port, hostname, () => {
      server.off('error', onError)
      server.on('error', () => undefined)
      const address = server.address()
      const boundPort = typeof address === 'object' && address !== null ? address.port : port
      resolve({
        port: boundPort,
        stop: async () => {
          for (const session of sessions) session.destroy()
          sessions.clear()
          await new Promise<void>((done) => server.close(() => done()))
        },
      })
    })
  })
}
