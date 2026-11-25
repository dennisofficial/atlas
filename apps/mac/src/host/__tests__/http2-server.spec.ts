import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from 'node:http2'

import { serveHttp2, type IServedHttp2 } from '../http2-server'
import { createSelfSignedCert } from '../tls/self-signed'

const ABORT_TIMEOUT_MS = 2_000

const encoder = new TextEncoder()

let server: IServedHttp2
let client: ClientHttp2Session
let aborted = (): void => {}
let finishedAborts = 0

const abortObserved = new Promise<void>((resolve) => {
  aborted = resolve
})

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/hello') {
    request.signal.addEventListener('abort', () => {
      finishedAborts += 1
    })
    return new Response('hello', {
      headers: { 'x-host': request.headers.get('host') ?? '', 'x-url': request.url },
    })
  }
  if (url.pathname === '/echo') return new Response(await request.text())
  if (url.pathname === '/events') {
    let timer: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: hi\n\n'))
        timer = setInterval(() => controller.enqueue(encoder.encode('data: tick\n\n')), 200)
      },
      cancel() {
        clearInterval(timer)
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
  if (url.pathname === '/slow') {
    request.signal.addEventListener('abort', () => aborted())
    return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  if (url.pathname === '/cookies') {
    const headers = new Headers()
    headers.append('set-cookie', 'first=1; Path=/')
    headers.append('set-cookie', 'second=2; Path=/')
    return new Response('ok', { headers })
  }
  if (url.pathname === '/connection')
    return new Response('ok', { headers: { connection: 'keep-alive', 'keep-alive': 'timeout=5' } })
  if (url.pathname === '/boom') throw new Error('boom')
  return new Response('missing', { status: 404 })
}

beforeAll(async () => {
  const tls = createSelfSignedCert({ now: Date.now() })
  server = await serveHttp2({
    hostname: '127.0.0.1',
    port: 0,
    tls: { cert: tls.certPem, key: tls.keyPem },
    fetch: handle,
  })
  client = connect(`https://127.0.0.1:${server.port}`, { rejectUnauthorized: false })
  client.on('error', () => undefined)
  await once(client, 'connect')
})

afterAll(async () => {
  client.destroy()
  await server.stop()
})

async function call({
  path,
  method = 'GET',
  body,
}: {
  path: string
  method?: string
  body?: string
}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const stream = client.request({ ':path': path, ':method': method })
  const headers: IncomingHttpHeaders = {}
  const chunks: Buffer[] = []
  let status = 0
  stream.on('response', (received) => {
    status = Number(received[':status'])
    Object.assign(headers, received)
  })
  stream.on('data', (chunk: Buffer) => chunks.push(chunk))
  const ended = once(stream, 'end')
  stream.end(body)
  await ended
  return { status, headers, body: Buffer.concat(chunks).toString() }
}

describe('serveHttp2', () => {
  test('answers a GET for the authority the client dialled', async () => {
    const reply = await call({ path: '/hello' })
    expect(reply.status).toBe(200)
    expect(reply.body).toBe('hello')
    expect(reply.headers['x-host']).toBe(`127.0.0.1:${server.port}`)
    expect(reply.headers['x-url']).toBe(`https://127.0.0.1:${server.port}/hello`)
  })

  test('never aborts the signal of a request that already answered', async () => {
    expect((await call({ path: '/hello' })).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(finishedAborts).toBe(0)
  })

  test('streams a POST body into the handler', async () => {
    const reply = await call({ path: '/echo', method: 'POST', body: 'ping pong' })
    expect(reply.status).toBe(200)
    expect(reply.body).toBe('ping pong')
  })

  test('answers a GET while ten event streams pin the same connection', async () => {
    const streams = []
    for (let index = 0; index < 10; index += 1) {
      const stream = client.request({ ':path': '/events', ':method': 'GET' })
      stream.on('error', () => undefined)
      stream.on('data', () => undefined)
      streams.push(stream)
      await once(stream, 'response')
    }
    const started = performance.now()
    const reply = await call({ path: '/hello' })
    const elapsed = performance.now() - started
    for (const stream of streams) stream.close()
    expect(reply.body).toBe('hello')
    expect(elapsed).toBeLessThan(1_000)
  })

  test('aborts the request signal when the client cancels the response', async () => {
    const stream = client.request({ ':path': '/slow', ':method': 'GET' })
    stream.on('error', () => undefined)
    await once(stream, 'response')
    stream.close()
    const timedOut = Symbol('timeout')
    const settled = await Promise.race([
      abortObserved.then(() => 'aborted' as const),
      new Promise((resolve) => setTimeout(() => resolve(timedOut), ABORT_TIMEOUT_MS)),
    ])
    expect(settled).toBe('aborted')
  })

  test('sends multiple set-cookie headers as an array', async () => {
    const reply = await call({ path: '/cookies' })
    expect(reply.headers['set-cookie']).toEqual(['first=1; Path=/', 'second=2; Path=/'])
  })

  test('drops connection-specific response headers HTTP/2 rejects', async () => {
    const reply = await call({ path: '/connection' })
    expect(reply.status).toBe(200)
    expect(reply.body).toBe('ok')
    expect(reply.headers.connection).toBeUndefined()
    expect(reply.headers['keep-alive']).toBeUndefined()
  })

  test('answers 500 when the handler throws', async () => {
    const reply = await call({ path: '/boom' })
    expect(reply.status).toBe(500)
    expect(await call({ path: '/hello' })).toMatchObject({ status: 200, body: 'hello' })
  })
})
