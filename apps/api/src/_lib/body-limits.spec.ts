import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'bun:test'
import { json } from 'express'
import { JSON_BODY_LIMIT } from './body-limits'

const FOUR_MIB = 4 * 1024 * 1024

const appWithParsers = () => {
  const app = express()
  app.use(json({ limit: JSON_BODY_LIMIT }))
  const echoLength: express.RequestHandler = (req, res) => {
    res.status(200).json({ length: (req.body as { blob: string }).blob.length })
  }
  app.post('/v1/secrets', echoLength)
  return app
}

const blobOf = (bytes: number): string => JSON.stringify({ blob: 'x'.repeat(bytes) })

describe('JSON_BODY_LIMIT', () => {
  it('is 4mb', () => {
    expect(JSON_BODY_LIMIT).toBe('4mb')
  })

  it('parses a body just under the limit', async () => {
    const response = await request(appWithParsers())
      .post('/v1/secrets')
      .set('content-type', 'application/json')
      .send(blobOf(FOUR_MIB - 1024))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ length: FOUR_MIB - 1024 })
  })

  it('rejects a body over the limit with 413', async () => {
    const response = await request(appWithParsers())
      .post('/v1/secrets')
      .set('content-type', 'application/json')
      .send(blobOf(FOUR_MIB + 1024))
    expect(response.status).toBe(413)
  })
})
