import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  assertGzipContentType,
  bufferBodyOf,
  contextArchiveRawParser,
  isGzipContentType,
  wantsGzipResponse,
} from './context-archive-http'

describe('isGzipContentType', () => {
  it('matches the exact media type and tolerates a charset suffix', () => {
    expect(isGzipContentType('application/gzip')).toBe(true)
    expect(isGzipContentType('application/gzip; charset=binary')).toBe(true)
    expect(isGzipContentType('APPLICATION/GZIP')).toBe(true)
  })

  it('rejects anything else, including absence', () => {
    expect(isGzipContentType('application/json')).toBe(false)
    expect(isGzipContentType(undefined)).toBe(false)
  })
})

describe('wantsGzipResponse', () => {
  it('matches an Accept header naming the gzip media type, alone or in a list', () => {
    expect(wantsGzipResponse('application/gzip')).toBe(true)
    expect(wantsGzipResponse('text/plain, application/gzip')).toBe(true)
  })

  it('answers false without the header or without the gzip type in it', () => {
    expect(wantsGzipResponse(undefined)).toBe(false)
    expect(wantsGzipResponse('application/json')).toBe(false)
  })
})

describe('assertGzipContentType', () => {
  it('passes a gzip content type through', () => {
    expect(() => assertGzipContentType('application/gzip')).not.toThrow()
  })

  it('rejects everything else with 415', () => {
    expect(() => assertGzipContentType('application/json')).toThrow(UnsupportedMediaTypeException)
    expect(() => assertGzipContentType(undefined)).toThrow(UnsupportedMediaTypeException)
  })
})

describe('bufferBodyOf', () => {
  it('returns a Buffer body as is', () => {
    const body = Buffer.from('archive bytes')
    expect(bufferBodyOf(body)).toBe(body)
  })

  it('rejects a non-Buffer body with 400', () => {
    expect(() => bufferBodyOf({ not: 'a buffer' })).toThrow(BadRequestException)
    expect(() => bufferBodyOf(undefined)).toThrow(BadRequestException)
  })
})

describe('contextArchiveRawParser', () => {
  const appWithLimit = (limitBytes: number) => {
    const app = express()
    app.use('/put', contextArchiveRawParser({ limitBytes }))
    app.use(express.json())
    app.put('/put', (req, res) => {
      if (Buffer.isBuffer(req.body)) {
        res.status(204).end()
        return
      }
      res.status(200).json(req.body)
    })
    app.use(
      (
        error: { status?: number },
        _request: express.Request,
        response: express.Response,
        _next: express.NextFunction,
      ) => {
        response.status(error.status ?? 500).end()
      },
    )
    return app
  }

  it('parses a gzip body into a Buffer within the limit', async () => {
    await request(appWithLimit(1024))
      .put('/put')
      .set('Content-Type', 'application/gzip')
      .send(Buffer.from('short archive'))
      .expect(204)
  })

  it('rejects a gzip body over the limit with 413, before it reaches the handler', async () => {
    await request(appWithLimit(4))
      .put('/put')
      .set('Content-Type', 'application/gzip')
      .send(Buffer.from('an archive well past four bytes'))
      .expect(413)
  })

  it('leaves a non-gzip body for the next parser in the chain', async () => {
    await request(appWithLimit(1024))
      .put('/put')
      .set('Content-Type', 'application/json')
      .send({ bundle: 'legacy' })
      .expect(200, { bundle: 'legacy' })
  })
})
