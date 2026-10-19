import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
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
  app.put('/v1/user-files/:tree/*path', echoLength)
  app.post('/v1/user-files/get', echoLength)
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

describe('user-files bodies', () => {
  it('rejects a user-file PUT body over the global limit with 413', async () => {
    const response = await request(appWithParsers())
      .put('/v1/user-files/skills/big/SKILL.md')
      .set('content-type', 'application/json')
      .send(blobOf(FOUR_MIB + 1024))
    expect(response.status).toBe(413)
  })

  it('parses a user-file PUT body at the harness cap', async () => {
    const base64OfHarnessCap = Math.ceil(3_000_000 / 3) * 4
    const response = await request(appWithParsers())
      .put('/v1/user-files/skills/big/SKILL.md')
      .set('content-type', 'application/json')
      .send(blobOf(base64OfHarnessCap))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ length: base64OfHarnessCap })
  })

  it('keeps other user-files methods on the global limit', async () => {
    const response = await request(appWithParsers())
      .post('/v1/user-files/get')
      .set('content-type', 'application/json')
      .send(blobOf(FOUR_MIB + 1024))
    expect(response.status).toBe(413)
  })
})
