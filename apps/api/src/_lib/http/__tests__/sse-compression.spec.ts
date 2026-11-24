import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import express from 'express'
import http from 'node:http'
import { gunzipSync } from 'node:zlib'

import { sseCompression } from '../sse-compression'

const SSE_BODY = 'data: one\n\ndata: two\n\n'

const appOf = (): express.Express => {
  const app = express()
  app.use(sseCompression())
  app.get('/sse', (_request, response) => {
    response.setHeader('content-type', 'text/event-stream')
    response.write('data: one\n\n')
    response.write('data: two\n\n')
    response.end()
  })
  app.get('/json', (_request, response) => {
    response.json({ hello: 'world' })
  })
  return app
}

type Reply = { headers: http.IncomingHttpHeaders; body: Buffer; encoding: string | undefined }

const get = (args: {
  port: number
  path: string
  acceptEncoding?: string | undefined
}): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port: args.port,
        path: args.path,
        headers:
          args.acceptEncoding === undefined ? {} : { 'accept-encoding': args.acceptEncoding },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const encoding = response.headers['content-encoding']
          const raw = Buffer.concat(chunks)
          resolve({
            headers: response.headers,
            body: encoding === 'gzip' ? gunzipSync(raw) : raw,
            encoding,
          })
        })
      },
    )
    request.on('error', reject)
  })

describe('sse compression', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    server = http.createServer(appOf())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    port = address.port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('gzips an event stream', async () => {
    const reply = await get({ port, path: '/sse', acceptEncoding: 'gzip, deflate, br' })
    expect(reply.encoding).toBe('gzip')
    expect(reply.body.toString()).toBe(SSE_BODY)
  })

  it('leaves a JSON response alone', async () => {
    const reply = await get({ port, path: '/json', acceptEncoding: 'gzip, deflate, br' })
    expect(reply.encoding).toBeUndefined()
    expect(JSON.parse(reply.body.toString())).toEqual({ hello: 'world' })
  })

  it('answers an event stream as identity when the client cannot decompress', async () => {
    const reply = await get({ port, path: '/sse' })
    expect(reply.encoding).toBeUndefined()
    expect(reply.body.toString()).toBe(SSE_BODY)
  })
})
