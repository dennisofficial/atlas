import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  GITHUB_WEBHOOK_BODY_LIMIT,
  webhookJsonParser,
} from './webhook-body-limit'

const appWithParser = (limit: string) => {
  const app = express()
  app.use('/hook', webhookJsonParser({ limit }))
  app.post('/hook', (req, res) => {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody
    res.status(200).json({ rawBodyLength: rawBody?.length ?? null })
  })
  return app
}

describe('webhookJsonParser', () => {
  it('parses a small JSON body and exposes rawBody for HMAC verification', async () => {
    const payload = JSON.stringify({ hello: 'world' })
    const response = await request(appWithParser(GITHUB_WEBHOOK_BODY_LIMIT))
      .post('/hook')
      .set('content-type', 'application/json')
      .send(payload)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ rawBodyLength: Buffer.byteLength(payload) })
  })

  it('rejects a body over the limit before it is buffered', async () => {
    const payload = JSON.stringify({ blob: 'x'.repeat(1024 * 1024) })
    const response = await request(appWithParser(GITHUB_WEBHOOK_BODY_LIMIT))
      .post('/hook')
      .set('content-type', 'application/json')
      .send(payload)
    expect(response.status).toBe(413)
  })
})
