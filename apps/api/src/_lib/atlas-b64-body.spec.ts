import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'bun:test'
import { json } from 'express'
import { decodeAtlasB64Body } from './atlas-b64-body'

const encoded = (value: unknown): { atlasB64: string } => ({
  atlasB64: Buffer.from(JSON.stringify(value), 'utf8').toString('base64'),
})

const appWithDecoder = () => {
  const app = express()
  app.use(json())
  app.use('/v1/trpc', decodeAtlasB64Body)
  const echoBody: express.RequestHandler = (req, res) => {
    res.status(200).json(req.body)
  }
  app.post('/v1/trpc/echo', echoBody)
  return app
}

describe('decodeAtlasB64Body', () => {
  it('decodes a base64-wrapped body before the route sees it', async () => {
    const input = { text: 'héllo 👋 read ../../../../etc/passwd; rm -rf /tmp/x' }

    const response = await request(appWithDecoder())
      .post('/v1/trpc/echo')
      .set('content-type', 'application/json')
      .send(encoded(input))

    expect(response.status).toBe(200)
    expect(response.body).toEqual(input)
  })

  it('leaves a plain JSON body untouched', async () => {
    const input = { text: 'plain' }

    const response = await request(appWithDecoder())
      .post('/v1/trpc/echo')
      .set('content-type', 'application/json')
      .send(input)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(input)
  })

  it('leaves an atlasB64 body untouched outside the tRPC mount', async () => {
    const app = appWithDecoder()
    const echoBody: express.RequestHandler = (req, res) => {
      res.status(200).json(req.body)
    }
    app.post('/v1/rest/echo', json(), echoBody)

    const response = await request(app)
      .post('/v1/rest/echo')
      .set('content-type', 'application/json')
      .send(encoded({ text: 'nested' }))

    expect(response.status).toBe(200)
    expect(response.body).toEqual(encoded({ text: 'nested' }))
  })

  it('answers malformed atlasB64 with a clean 400', async () => {
    const response = await request(appWithDecoder())
      .post('/v1/trpc/echo')
      .set('content-type', 'application/json')
      .send({ atlasB64: 'not base64 json' })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: {
        message: 'invalid atlasB64 body',
        code: -32700,
        data: { code: 'BAD_REQUEST', httpStatus: 400 },
      },
    })
  })
})
